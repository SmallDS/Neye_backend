import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventLogCategory, EventLogLevel, EventLogResult, Prisma } from '@prisma/client';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ClearEventLogsDto, ClearEventLogsPreviewDto } from './dto/clear-event-logs.dto';
import { EventLogQueryDto } from './dto/event-log-query.dto';
import { eventLogClearConfirmation, shanghaiMidnightToUtc } from './event-log-policy';

const RETENTION_KEY = 'event_logs.retention_days';
const LAST_CLEANUP_KEY = 'event_logs.last_retention_cleanup_date';
const DEFAULT_RETENTION_DAYS = 180;
const RETENTION_LOCK_ID = 73019420260719;
const DAY_MS = 86_400_000;

export interface RecordEventLogInput {
  level: EventLogLevel;
  category: EventLogCategory;
  result: EventLogResult;
  module: string;
  action: string;
  actorUserId?: string | null;
  actorUsername?: string | null;
  tenantId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  reason?: string | null;
  errorSummary?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class EventLogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventLogsService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.scheduleNextCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
  }

  async recordSafe(input: RecordEventLogInput) {
    try {
      return await this.prisma.eventLog.create({ data: this.toCreateData(input) });
    } catch (error) {
      this.logger.error(`Event log persistence failed: ${this.safeErrorSummary(error)}`);
      return null;
    }
  }

  async list(query: EventLogQueryDto) {
    const where: Prisma.EventLogWhereInput = {
      ...(query.level ? { level: query.level } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.module ? { module: query.module } : {}),
      ...(query.actorUsername ? { actorUsername: { contains: query.actorUsername, mode: 'insensitive' } } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.startAt || query.endAt
        ? { createdAt: { ...(query.startAt ? { gte: new Date(query.startAt) } : {}), ...(query.endAt ? { lte: new Date(query.endAt) } : {}) } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.eventLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.eventLog.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) {
    const item = await this.prisma.eventLog.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Event log not found');
    return item;
  }

  async getRetention() {
    return { retentionDays: await this.readRetentionDays() };
  }

  async updateRetention(retentionDays: number, actor: CurrentUser) {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    return this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: RETENTION_KEY },
        create: { key: RETENTION_KEY, value: retentionDays },
        update: { value: retentionDays },
      });
      const deleted = await tx.eventLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      await tx.eventLog.create({ data: this.toCreateData({
        level: EventLogLevel.INFO,
        category: EventLogCategory.AUDIT,
        result: EventLogResult.SUCCESS,
        module: 'event_logs',
        action: 'RETENTION_UPDATED',
        actorUserId: actor.id,
        actorUsername: actor.username,
        reason: `Retention changed to ${retentionDays} days`,
        metadata: { retentionDays, deletedCount: deleted.count, cutoff: cutoff.toISOString() },
      }) });
      return { retentionDays, deletedCount: deleted.count };
    });
  }

  async previewClear(dto: ClearEventLogsPreviewDto) {
    const where = this.clearWhere(dto);
    const expectedCount = await this.prisma.eventLog.count({ where });
    return {
      scope: dto.scope,
      ...(dto.beforeDate ? { beforeDate: dto.beforeDate } : {}),
      ...(where.createdAt && typeof where.createdAt === 'object' && 'lt' in where.createdAt
        ? { cutoff: (where.createdAt.lt as Date).toISOString() }
        : {}),
      expectedCount,
      confirmationText: this.confirmationText(dto, expectedCount),
    };
  }

  async clear(dto: ClearEventLogsDto, actor: CurrentUser) {
    const reason = dto.reason.trim();
    if (reason.length < 5 || reason.length > 500) throw new BadRequestException('reason must contain 5 to 500 non-whitespace characters');
    const where = this.clearWhere(dto);
    const expectedConfirmation = this.confirmationText(dto, dto.expectedCount);
    if (dto.confirmationText !== expectedConfirmation) throw new ConflictException('Confirmation text does not match the current preview');

    return this.prisma.$transaction(async (tx) => {
      const actualCount = await tx.eventLog.count({ where });
      if (actualCount !== dto.expectedCount) {
        throw new ConflictException({
          message: 'Event log count changed; preview again before clearing',
          expectedCount: dto.expectedCount,
          actualCount,
        });
      }
      const deleted = await tx.eventLog.deleteMany({ where });
      const summary = await tx.eventLog.create({ data: this.toCreateData({
        level: EventLogLevel.WARN,
        category: EventLogCategory.AUDIT,
        result: EventLogResult.SUCCESS,
        module: 'event_logs',
        action: 'CLEARED',
        actorUserId: actor.id,
        actorUsername: actor.username,
        reason,
        metadata: {
          scope: dto.scope,
          ...(dto.beforeDate ? { beforeDate: dto.beforeDate } : {}),
          deletedCount: deleted.count,
        },
      }) });
      return { deletedCount: deleted.count, summaryLogId: summary.id };
    });
  }

  private clearWhere(dto: ClearEventLogsPreviewDto): Prisma.EventLogWhereInput {
    if (dto.scope === 'all') return {};
    if (!dto.beforeDate) throw new ConflictException('beforeDate is required');
    return { createdAt: { lt: this.shanghaiMidnightToUtc(dto.beforeDate) } };
  }

  private shanghaiMidnightToUtc(value: string) {
    try {
      return shanghaiMidnightToUtc(value);
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'Invalid beforeDate');
    }
  }

  private confirmationText(dto: ClearEventLogsPreviewDto, count: number) {
    return eventLogClearConfirmation(dto, count);
  }

  private async readRetentionDays(client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const setting = await client.systemSetting.findUnique({ where: { key: RETENTION_KEY } });
    const value = typeof setting?.value === 'number' ? setting.value : Number(setting?.value);
    return Number.isInteger(value) && value >= 30 && value <= 730 ? value : DEFAULT_RETENTION_DAYS;
  }

  private scheduleNextCleanup() {
    const now = new Date();
    const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    let next = new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate(), 2, 30) - 8 * 60 * 60 * 1000);
    if (next <= now) next = new Date(next.getTime() + DAY_MS);
    this.cleanupTimer = setTimeout(() => {
      void this.runScheduledCleanup().finally(() => this.scheduleNextCleanup());
    }, next.getTime() - now.getTime());
    this.cleanupTimer.unref?.();
  }

  private async runScheduledCleanup() {
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS locked`);
        if (!rows[0]?.locked) return;
        const today = this.shanghaiDate(new Date());
        const last = await tx.systemSetting.findUnique({ where: { key: LAST_CLEANUP_KEY } });
        if (last?.value === today) return;
        const retentionDays = await this.readRetentionDays(tx);
        const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
        const deleted = await tx.eventLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        await tx.systemSetting.upsert({
          where: { key: LAST_CLEANUP_KEY },
          create: { key: LAST_CLEANUP_KEY, value: today },
          update: { value: today },
        });
        await tx.eventLog.create({ data: this.toCreateData({
          level: EventLogLevel.INFO,
          category: EventLogCategory.SYSTEM,
          result: EventLogResult.SUCCESS,
          module: 'event_logs',
          action: 'RETENTION_CLEANUP',
          reason: `Automatic retention cleanup (${retentionDays} days)`,
          metadata: { retentionDays, cutoff: cutoff.toISOString(), deletedCount: deleted.count },
        }) });
      });
    } catch (error) {
      this.logger.error(`Scheduled event log cleanup failed: ${this.safeErrorSummary(error)}`);
    }
  }

  private shanghaiDate(date: Date) {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private toCreateData(input: RecordEventLogInput): Prisma.EventLogUncheckedCreateInput {
    return {
      level: input.level,
      category: input.category,
      result: input.result,
      module: input.module.slice(0, 80),
      action: input.action.slice(0, 80),
      actorUserId: input.actorUserId || null,
      actorUsername: input.actorUsername ? this.redactText(input.actorUsername).slice(0, 80) : null,
      tenantId: input.tenantId || null,
      resourceType: input.resourceType?.slice(0, 80) || null,
      resourceId: input.resourceId?.slice(0, 160) || null,
      requestId: input.requestId?.slice(0, 128) || null,
      ipAddress: input.ipAddress?.slice(0, 64) || null,
      reason: input.reason ? this.redactText(input.reason) : null,
      errorSummary: input.errorSummary ? this.redactText(input.errorSummary) : null,
      ...(input.metadata !== undefined ? { metadata: this.sanitizeMetadata(input.metadata) } : {}),
    };
  }

  private sanitizeMetadata(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
    if (Array.isArray(value)) return value.map((item) => this.sanitizeMetadata(item));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !/(password|secret|token|authorization|cookie|openid|session|raw)/i.test(key))
          .map(([key, item]) => [key, this.sanitizeMetadata(item as Prisma.InputJsonValue)]),
      );
    }
    return typeof value === 'string' ? this.redactText(value) : value;
  }
  private redactText(value: string) {
    return value
      .slice(0, 1000)
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      .replace(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, '[REDACTED]')
      .replace(/(password|appSecret|openId|session|cookie|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
      .replace(/\b(\d{3})\d{4}(\d{4})\b/g, '$1****$2');
  }

  private safeErrorSummary(error: unknown) {
    return error instanceof Error ? error.constructor.name : 'unknown error';
  }
}