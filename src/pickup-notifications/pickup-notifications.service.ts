import { BadGatewayException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { EventLogCategory, EventLogLevel, EventLogResult, PickupNotificationTaskStatus, Prisma } from '@prisma/client';
import { tenantFilter } from '../common/tenant-scope';
import { CurrentUser } from '../common/types/current-user';
import { EventLogsService } from '../event-logs/event-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { WECHAT_PICKUP_NOTIFICATION_KEY, WechatPickupNotificationSetting, normalizeWechatPickupNotification, validateWechatPickupNotification } from '../system-settings/wechat-pickup-notification';
import { WechatApiClient } from '../wechat/wechat-api.client';
import { WechatApiError } from '../wechat/wechat-api.error';
import { PickupSceneDto, SubscribePickupNotificationDto } from './dto/public-pickup-subscription.dto';
import { createPickupScene, projectPickupNotification, PICKUP_NOTIFICATION_PAGE, PickupProjectionInput } from './pickup-notification-status';

const PUBLIC_PICKUP_COPY = '眼镜可取时，我们将发送一次微信通知。';

@Injectable()
export class PickupNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatApi: WechatApiClient,
    private readonly eventLogs: EventLogsService,
  ) {}

  async getPublicContext(dto: PickupSceneDto) {
    const scene = await this.prisma.fittingPickupScene.findUnique({
      where: { scene: dto.scene },
      include: {
        fittingOrder: {
          include: { tenant: true, pickupSubscription: true, pickupNotificationTask: true },
        },
      },
    });
    if (!scene || scene.fittingOrder.deletedAt) throw new NotFoundException('取镜订阅信息不存在');
    const settingState = await this.getSettingState();
    const expired = scene.expiresAt <= new Date();
    const locked = Boolean(scene.fittingOrder.pickupSubscription?.lockedAt);
    const state = expired ? 'expired' : locked ? 'locked' : settingState.usable ? 'available' : 'disabled';
    return {
      state,
      orderNo: scene.fittingOrder.orderNo,
      storeName: scene.fittingOrder.tenant.name,
      pickupCopy: PUBLIC_PICKUP_COPY,
      templateId: settingState.setting.templateId,
      expiresAt: scene.expiresAt,
      readyForPickup: Boolean(scene.fittingOrder.readyForPickupAt),
      receiverLocked: locked,
    };
  }

  async subscribe(dto: SubscribePickupNotificationDto) {
    const sceneRecord = await this.prisma.fittingPickupScene.findUnique({
      where: { scene: dto.scene },
      include: { fittingOrder: { include: { pickupSubscription: true } } },
    });
    if (!sceneRecord || sceneRecord.fittingOrder.deletedAt) throw new NotFoundException('取镜订阅信息不存在');
    if (sceneRecord.expiresAt <= new Date()) return { status: 'expired', receiverLocked: false, notificationStatus: 'unsubscribed' };

    const settingState = await this.getSettingState();
    if (!settingState.usable) return { status: 'disabled', receiverLocked: false, notificationStatus: 'unsubscribed' };
    if (dto.templateId !== settingState.setting.templateId) throw new ConflictException('订阅模板已更新，请刷新后重试');

    let identity: { appId: string; openId: string };
    try {
      identity = await this.wechatApi.exchangeMiniappCode(dto.code);
    } catch (error) {
      if (error instanceof WechatApiError) {
        if (error.kind === 'invalid_code') throw new UnauthorizedException(error.safeMessage);
        if (error.kind === 'configuration') throw new ServiceUnavailableException(error.safeMessage);
        throw new BadGatewayException(error.safeMessage);
      }
      throw error;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockFittingOrder(tx, sceneRecord.fittingOrderId);
      const order = await tx.fittingOrder.findUnique({
        where: { id: sceneRecord.fittingOrderId },
        include: { pickupScene: true, pickupSubscription: true, pickupNotificationTask: true },
      });
      if (!order || order.deletedAt || !order.pickupScene) throw new NotFoundException('取镜订阅信息不存在');
      if (order.pickupScene.expiresAt <= new Date()) return { status: 'expired' as const, subscribedAt: null, receiverLocked: false, notificationStatus: 'unsubscribed' as const };
      if (order.readyForPickupAt && order.pickupSubscription) {
        if (order.pickupSubscription.openId === identity.openId) {
          return { status: 'subscribed' as const, subscribedAt: order.pickupSubscription.subscribedAt, receiverLocked: true, notificationStatus: this.taskPublicStatus(order.pickupNotificationTask?.status) };
        }
        return { status: 'locked' as const, subscribedAt: null, receiverLocked: true, notificationStatus: this.taskPublicStatus(order.pickupNotificationTask?.status) };
      }
      if (!order.readyForPickupAt && order.pickupSubscription?.openId === identity.openId) {
        return {
          status: 'subscribed' as const,
          subscribedAt: order.pickupSubscription.subscribedAt,
          receiverLocked: false,
          notificationStatus: this.taskPublicStatus(order.pickupNotificationTask?.status),
        };
      }

      const now = new Date();
      const subscription = await tx.fittingPickupSubscription.upsert({
        where: { fittingOrderId: order.id },
        create: {
          fittingOrderId: order.id,
          appId: identity.appId,
          openId: identity.openId,
          templateId: settingState.setting.templateId,
          keywordMapping: settingState.setting.keywordMapping as unknown as Prisma.InputJsonValue,
          pickupTip: settingState.setting.pickupTip,
          subscribedAt: now,
          lockedAt: order.readyForPickupAt ? now : null,
        },
        update: {
          appId: identity.appId,
          openId: identity.openId,
          templateId: settingState.setting.templateId,
          keywordMapping: settingState.setting.keywordMapping as unknown as Prisma.InputJsonValue,
          pickupTip: settingState.setting.pickupTip,
          subscribedAt: now,
          lockedAt: order.readyForPickupAt ? now : null,
        },
      });
      if (order.readyForPickupAt) await this.ensureTask(tx, order.id, order.tenantId, subscription.id);
      return { status: 'subscribed' as const, subscribedAt: now, receiverLocked: Boolean(order.readyForPickupAt), notificationStatus: 'pending' as const };
    });
    await this.eventLogs.recordSafe({
      level: EventLogLevel.INFO,
      category: EventLogCategory.AUDIT,
      result: EventLogResult.SUCCESS,
      module: 'pickup_notifications',
      action: 'PICKUP_SUBSCRIBED',
      resourceType: 'fitting_order',
      resourceId: sceneRecord.fittingOrderId,
      metadata: { receiverLocked: result.receiverLocked },
    });
    return result;
  }

  async getQr(user: CurrentUser, fittingOrderId: string) {
    const order = await this.requireOrder(user, fittingOrderId);
    let scene = order.pickupScene;
    if (!scene) {
      scene = await this.prisma.fittingPickupScene.upsert({
        where: { fittingOrderId },
        create: { fittingOrderId, ...createPickupScene() },
        update: {},
      });
    }
    try {
      const bytes = await this.wechatApi.createUnlimitedQr({ scene: scene.scene, page: PICKUP_NOTIFICATION_PAGE });
      return { qrCodeDataUrl: `data:image/png;base64,${bytes.toString('base64')}`, expiresAt: scene.expiresAt, page: PICKUP_NOTIFICATION_PAGE };
    } catch (error) {
      if (error instanceof WechatApiError) {
        if (error.kind === 'configuration') throw new ServiceUnavailableException(error.safeMessage);
        throw new BadGatewayException(error.safeMessage);
      }
      throw error;
    }
  }

  async markReady(user: CurrentUser, fittingOrderId: string) {
    await this.requireOrder(user, fittingOrderId);
    const settingState = await this.getSettingState();
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockFittingOrder(tx, fittingOrderId);
      const order = await tx.fittingOrder.findUnique({ where: { id: fittingOrderId }, include: { pickupSubscription: true } });
      if (!order || order.deletedAt) throw new NotFoundException('Fitting order not found');
      const readyForPickupAt = order.readyForPickupAt ?? new Date();
      if (!order.readyForPickupAt) await tx.fittingOrder.update({ where: { id: order.id }, data: { readyForPickupAt } });
      let taskCreated = false;
      if (order.pickupSubscription) {
        await tx.fittingPickupSubscription.update({ where: { id: order.pickupSubscription.id }, data: { lockedAt: order.pickupSubscription.lockedAt ?? readyForPickupAt } });
        if (settingState.usable) {
          const task = await this.ensureTask(tx, order.id, order.tenantId, order.pickupSubscription.id);
          taskCreated = Boolean(task);
        }
      }
      return { readyForPickupAt, receiverSubscribed: Boolean(order.pickupSubscription), taskCreated };
    });
    await this.eventLogs.recordSafe({
      level: EventLogLevel.INFO, category: EventLogCategory.AUDIT, result: EventLogResult.SUCCESS,
      module: 'pickup_notifications', action: 'PICKUP_READY_MARKED', actorUserId: user.id, actorUsername: user.username,
      tenantId: user.tenantId, resourceType: 'fitting_order', resourceId: fittingOrderId,
      metadata: { receiverSubscribed: outcome.receiverSubscribed, taskCreated: outcome.taskCreated },
    });
    const order = await this.requireOrder(user, fittingOrderId);
    return { id: order.id, readyForPickupAt: outcome.readyForPickupAt, pickupNotification: this.project(order, settingState) };
  }

  async retryFailed(user: CurrentUser, fittingOrderId: string, reason: string) {
    await this.requireOrder(user, fittingOrderId);
    const settingState = await this.getSettingState();
    if (!settingState.usable) throw new ConflictException('取镜通知配置尚未恢复有效');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockFittingOrder(tx, fittingOrderId);
      const order = await tx.fittingOrder.findUnique({ where: { id: fittingOrderId }, include: { pickupSubscription: true, pickupNotificationTask: true } });
      if (!order || order.deletedAt) throw new NotFoundException('Fitting order not found');
      if (!order.readyForPickupAt || !order.pickupSubscription) throw new ConflictException('当前订单不满足重试条件');
      if (order.pickupNotificationTask?.sentAt || order.pickupNotificationTask?.status === PickupNotificationTaskStatus.sent) throw new ConflictException('通知已发送，不能重试');
      let task;
      if (!order.pickupNotificationTask) {
        task = await this.ensureTask(tx, order.id, order.tenantId, order.pickupSubscription.id);
      } else {
        if (order.pickupNotificationTask.status !== PickupNotificationTaskStatus.failed) throw new ConflictException('仅失败任务可以重试');
        task = await tx.pickupNotificationTask.update({
          where: { id: order.pickupNotificationTask.id },
          data: { status: PickupNotificationTaskStatus.pending, cycle: { increment: 1 }, attemptInCycle: 0, nextAttemptAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null, lastErrorSummary: null },
        });
      }
      return task;
    });
    await this.eventLogs.recordSafe({
      level: EventLogLevel.WARN, category: EventLogCategory.AUDIT, result: EventLogResult.SUCCESS,
      module: 'pickup_notifications', action: 'PICKUP_NOTIFICATION_MANUAL_RETRY', actorUserId: user.id, actorUsername: user.username,
      tenantId: user.tenantId, resourceType: 'fitting_order', resourceId: fittingOrderId, reason,
      metadata: { taskId: result.id, cycle: result.cycle },
    });
    return { taskId: result.id, status: PickupNotificationTaskStatus.pending, cycle: result.cycle, nextAttemptAt: result.nextAttemptAt };
  }

  async attempts(user: CurrentUser, fittingOrderId: string) {
    const order = await this.requireOrder(user, fittingOrderId);
    if (!order.pickupNotificationTask) return { items: [] };
    const items = await this.prisma.pickupNotificationAttempt.findMany({
      where: { taskId: order.pickupNotificationTask.id },
      select: { cycle: true, attemptNo: true, startedAt: true, finishedAt: true, result: true, wechatErrorCode: true, errorSummary: true, tokenRefreshed: true, nextRetryAt: true },
      orderBy: { startedAt: 'desc' },
    });
    return { items };
  }

  async getSettingState(client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const [pickup, auth] = await Promise.all([
      client.systemSetting.findUnique({ where: { key: WECHAT_PICKUP_NOTIFICATION_KEY } }),
      client.systemSetting.findUnique({ where: { key: 'wechat_auth' } }),
    ]);
    const setting = normalizeWechatPickupNotification(pickup?.value);
    const authValue = (auth?.value ?? {}) as Record<string, unknown>;
    const credentialsConfigured = typeof authValue.appId === 'string' && Boolean(authValue.appId.trim()) && typeof authValue.appSecret === 'string' && Boolean(authValue.appSecret.trim());
    return { setting, usable: setting.enabled && credentialsConfigured && validateWechatPickupNotification(setting).length === 0, credentialsConfigured };
  }

  project(order: PickupProjectionInput, settingState: { setting: WechatPickupNotificationSetting; usable: boolean; credentialsConfigured?: boolean }) {
    const projection = projectPickupNotification(order, settingState.setting);
    if (projection.status === 'failed' && !order.pickupNotificationTask && settingState.setting.enabled && !settingState.credentialsConfigured) {
      return { ...projection, failureCode: 'CONFIG_INVALID', failureSummary: '微信小程序凭据未配置' };
    }
    return projection;
  }

  toSafeOrder<T extends PickupProjectionInput>(order: T, settingState: { setting: WechatPickupNotificationSetting; usable: boolean; credentialsConfigured?: boolean }) {
    const { pickupScene: _scene, pickupSubscription: _subscription, pickupNotificationTask: _task, ...safe } = order;
    return { ...safe, pickupNotification: this.project(order, settingState) };
  }

  private async requireOrder(user: CurrentUser, id: string) {
    const order = await this.prisma.fittingOrder.findFirst({
      where: { id, ...tenantFilter(user), deletedAt: null },
      include: { pickupScene: true, pickupSubscription: true, pickupNotificationTask: true },
    });
    if (!order) throw new NotFoundException('Fitting order not found');
    return order;
  }

  private async lockFittingOrder(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "fitting_orders" WHERE "id" = ${id}::uuid FOR UPDATE`);
    if (rows.length === 0) throw new NotFoundException('Fitting order not found');
  }

  private ensureTask(tx: Prisma.TransactionClient, fittingOrderId: string, tenantId: string, subscriptionId: string) {
    return tx.pickupNotificationTask.upsert({
      where: { fittingOrderId },
      create: { fittingOrderId, tenantId, subscriptionId, status: PickupNotificationTaskStatus.pending, nextAttemptAt: new Date() },
      update: {},
    });
  }

  private taskPublicStatus(status?: PickupNotificationTaskStatus) {
    if (status === PickupNotificationTaskStatus.retrying) return 'retrying' as const;
    if (status === PickupNotificationTaskStatus.sent) return 'sent' as const;
    if (status === PickupNotificationTaskStatus.failed) return 'failed' as const;
    return 'pending' as const;
  }
}