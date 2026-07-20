import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  EventLogCategory,
  EventLogLevel,
  EventLogResult,
  PickupNotificationAttemptResult,
  PickupNotificationTaskStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { EventLogsService } from '../event-logs/event-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { PickupKeywordMapping } from '../system-settings/wechat-pickup-notification';
import { WechatApiClient } from '../wechat/wechat-api.client';
import { WechatApiError } from '../wechat/wechat-api.error';
import {
  buildWechatPickupData,
  leaseRecoverySchedule,
  PICKUP_NOTIFICATION_LEASE_MS,
  PICKUP_NOTIFICATION_MAX_ATTEMPTS,
  PICKUP_NOTIFICATION_PAGE,
  retryDelayMs,
} from './pickup-notification-status';

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_CONCURRENCY = 2;

interface ClaimedTask {
  id: string;
  cycle: number;
  attemptInCycle: number;
}

@Injectable()
export class PickupNotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickupNotificationWorker.name);
  private readonly workerId = `pickup-${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatApi: WechatApiClient,
    private readonly eventLogs: EventLogsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.poll(), this.pollMs());
    this.timer.unref?.();
    void this.poll();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.recoverExpiredLeases();
      const tasks = await this.claimDueTasks();
      await Promise.all(tasks.map((task) => this.deliver(task)));
    } catch (error) {
      this.logger.error(`Pickup notification worker poll failed: ${this.safeErrorName(error)}`);
    } finally {
      this.polling = false;
    }
  }

  private async claimDueTasks() {
    const concurrency = this.concurrency();
    return this.prisma.$transaction(async (tx) => {
      const leaseExpiresAt = new Date(Date.now() + PICKUP_NOTIFICATION_LEASE_MS);
      const claimed = await tx.$queryRaw<ClaimedTask[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "pickup_notification_tasks"
          WHERE "status" IN ('pending', 'retrying')
            AND "next_attempt_at" <= NOW()
            AND "sent_at" IS NULL
          ORDER BY "next_attempt_at", "created_at"
          FOR UPDATE SKIP LOCKED
          LIMIT ${concurrency}
        )
        UPDATE "pickup_notification_tasks" AS task
        SET "status" = 'processing',
            "lease_owner" = ${this.workerId},
            "lease_expires_at" = ${leaseExpiresAt},
            "attempt_in_cycle" = task."attempt_in_cycle" + 1,
            "total_attempts" = task."total_attempts" + 1,
            "updated_at" = NOW()
        FROM candidates
        WHERE task."id" = candidates."id"
        RETURNING task."id", task."cycle", task."attempt_in_cycle" AS "attemptInCycle"
      `);
      if (claimed.length > 0) {
        await tx.pickupNotificationAttempt.createMany({
          data: claimed.map((task) => ({
            taskId: task.id,
            cycle: task.cycle,
            attemptNo: task.attemptInCycle,
            result: PickupNotificationAttemptResult.processing,
          })),
        });
      }
      return claimed;
    });
  }

  private async deliver(claimed: ClaimedTask) {
    const task = await this.prisma.pickupNotificationTask.findFirst({
      where: {
        id: claimed.id,
        status: PickupNotificationTaskStatus.processing,
        leaseOwner: this.workerId,
        sentAt: null,
      },
      include: { subscription: true, fittingOrder: true, tenant: true },
    });
    if (!task?.fittingOrder.readyForPickupAt) {
      await this.finishFailure(claimed, {
        kind: 'permanent', errorCode: 'ORDER_NOT_READY', summary: '取镜时间不存在', tokenRefreshed: false,
      });
      return;
    }

    try {
      const result = await this.wechatApi.sendSubscribeMessage({
        openId: task.subscription.openId,
        templateId: task.subscription.templateId,
        page: PICKUP_NOTIFICATION_PAGE,
        data: buildWechatPickupData(task.subscription.keywordMapping as unknown as PickupKeywordMapping[], {
          orderNo: task.fittingOrder.orderNo,
          storeName: task.tenant.name,
          readyForPickupAt: task.fittingOrder.readyForPickupAt,
          pickupTip: task.subscription.pickupTip,
        }),
      });
      await this.finishSuccess(task.id, claimed, result.messageId, result.tokenRefreshed, task.tenantId, task.fittingOrderId);
    } catch (error) {
      const failure = error instanceof WechatApiError
        ? {
            kind: error.kind === 'temporary' ? 'temporary' as const : 'permanent' as const,
            errorCode: error.wechatCode === undefined ? `WECHAT_${error.kind.toUpperCase()}` : `WECHAT_${error.wechatCode}`,
            summary: error.safeMessage,
            wechatErrorCode: error.wechatCode,
            tokenRefreshed: error.tokenRefreshed,
          }
        : { kind: 'temporary' as const, errorCode: 'UNEXPECTED_ERROR', summary: '发送服务暂时不可用', tokenRefreshed: false };
      await this.finishFailure(claimed, failure, task.tenantId, task.fittingOrderId);
    }
  }

  private async finishSuccess(
    taskId: string,
    claimed: ClaimedTask,
    messageId: string | undefined,
    tokenRefreshed: boolean,
    tenantId: string,
    fittingOrderId: string,
  ) {
    const finishedAt = new Date();
    const completed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pickupNotificationTask.updateMany({
        where: { id: taskId, status: PickupNotificationTaskStatus.processing, leaseOwner: this.workerId, sentAt: null },
        data: {
          status: PickupNotificationTaskStatus.sent,
          sentAt: finishedAt,
          wechatMessageId: messageId ?? null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorSummary: null,
        },
      });
      if (updated.count !== 1) return false;
      await tx.pickupNotificationAttempt.update({
        where: { taskId_cycle_attemptNo: { taskId, cycle: claimed.cycle, attemptNo: claimed.attemptInCycle } },
        data: { result: PickupNotificationAttemptResult.sent, finishedAt, tokenRefreshed },
      });
      return true;
    });
    if (!completed) return;
    await this.eventLogs.recordSafe({
      level: EventLogLevel.INFO,
      category: EventLogCategory.SYSTEM,
      result: EventLogResult.SUCCESS,
      module: 'pickup_notifications',
      action: 'PICKUP_NOTIFICATION_SENT',
      tenantId,
      resourceType: 'fitting_order',
      resourceId: fittingOrderId,
      metadata: { taskId, cycle: claimed.cycle, attemptNo: claimed.attemptInCycle, tokenRefreshed },
    });
  }

  private async finishFailure(
    claimed: ClaimedTask,
    failure: {
      kind: 'permanent' | 'temporary';
      errorCode: string;
      summary: string;
      wechatErrorCode?: number;
      tokenRefreshed: boolean;
    },
    tenantId?: string,
    fittingOrderId?: string,
  ) {
    const delay = failure.kind === 'temporary' ? retryDelayMs(claimed.attemptInCycle) : null;
    const retrying = delay !== null && claimed.attemptInCycle < PICKUP_NOTIFICATION_MAX_ATTEMPTS;
    const finishedAt = new Date();
    const nextRetryAt = retrying ? new Date(finishedAt.getTime() + delay) : null;
    const completed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pickupNotificationTask.updateMany({
        where: { id: claimed.id, status: PickupNotificationTaskStatus.processing, leaseOwner: this.workerId, sentAt: null },
        data: {
          status: retrying ? PickupNotificationTaskStatus.retrying : PickupNotificationTaskStatus.failed,
          nextAttemptAt: nextRetryAt ?? finishedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: failure.errorCode,
          lastErrorSummary: failure.summary,
        },
      });
      if (updated.count !== 1) return false;
      await tx.pickupNotificationAttempt.update({
        where: { taskId_cycle_attemptNo: { taskId: claimed.id, cycle: claimed.cycle, attemptNo: claimed.attemptInCycle } },
        data: {
          result: retrying ? PickupNotificationAttemptResult.temporary_failure : PickupNotificationAttemptResult.permanent_failure,
          finishedAt,
          wechatErrorCode: failure.wechatErrorCode,
          errorCode: failure.errorCode,
          errorSummary: failure.summary,
          tokenRefreshed: failure.tokenRefreshed,
          nextRetryAt,
        },
      });
      return true;
    });
    if (!completed) return;
    await this.eventLogs.recordSafe({
      level: retrying ? EventLogLevel.WARN : EventLogLevel.ERROR,
      category: EventLogCategory.SYSTEM,
      result: EventLogResult.FAILED,
      module: 'pickup_notifications',
      action: retrying ? 'PICKUP_NOTIFICATION_RETRY_SCHEDULED' : 'PICKUP_NOTIFICATION_FAILED',
      tenantId,
      resourceType: 'fitting_order',
      resourceId: fittingOrderId,
      errorSummary: failure.summary,
      metadata: {
        taskId: claimed.id,
        cycle: claimed.cycle,
        attemptNo: claimed.attemptInCycle,
        errorCode: failure.errorCode,
        tokenRefreshed: failure.tokenRefreshed,
        ...(nextRetryAt ? { nextRetryAt: nextRetryAt.toISOString() } : {}),
      },
    });
  }

  private async recoverExpiredLeases() {
    const expired = await this.prisma.$transaction((tx) => tx.$queryRaw<ClaimedTask[]>(Prisma.sql`
      SELECT "id", "cycle", "attempt_in_cycle" AS "attemptInCycle"
      FROM "pickup_notification_tasks"
      WHERE "status" = 'processing'
        AND "lease_expires_at" < NOW()
      ORDER BY "lease_expires_at"
      FOR UPDATE SKIP LOCKED
      LIMIT ${this.concurrency()}
    `));
    for (const task of expired) {
      const recoveredAt = new Date();
      const recovery = leaseRecoverySchedule(task.attemptInCycle, recoveredAt);
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.pickupNotificationTask.updateMany({
          where: { id: task.id, status: PickupNotificationTaskStatus.processing, leaseExpiresAt: { lt: recoveredAt }, sentAt: null },
          data: {
            status: recovery.retrying ? PickupNotificationTaskStatus.retrying : PickupNotificationTaskStatus.failed,
            nextAttemptAt: recovery.nextRetryAt ?? recoveredAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: 'LEASE_EXPIRED',
            lastErrorSummary: '发送任务租约超时',
          },
        });
        if (updated.count !== 1) return;
        await tx.pickupNotificationAttempt.updateMany({
          where: { taskId: task.id, cycle: task.cycle, attemptNo: task.attemptInCycle, finishedAt: null },
          data: {
            result: recovery.retrying ? PickupNotificationAttemptResult.temporary_failure : PickupNotificationAttemptResult.permanent_failure,
            finishedAt: recoveredAt,
            errorCode: 'LEASE_EXPIRED',
            errorSummary: '发送任务租约超时',
            nextRetryAt: recovery.nextRetryAt,
          },
        });
      });
    }
  }

  private pollMs() {
    return this.boundedInteger(process.env.PICKUP_NOTIFICATION_WORKER_POLL_MS, DEFAULT_POLL_MS, 500, 60_000);
  }

  private concurrency() {
    return this.boundedInteger(process.env.PICKUP_NOTIFICATION_WORKER_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 20);
  }

  private boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
    const value = Number(raw);
    return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  private safeErrorName(error: unknown) {
    return error instanceof Error ? error.constructor.name : 'unknown error';
  }
}