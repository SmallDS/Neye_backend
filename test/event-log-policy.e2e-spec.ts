import { ConflictException } from '@nestjs/common';
import { EventLogCategory, EventLogLevel, EventLogResult, UserRole } from '@prisma/client';
import { eventLogClearConfirmation, shanghaiMidnightToUtc } from '../src/event-logs/event-log-policy';
import { EventLogsService } from '../src/event-logs/event-logs.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('event log governance policy', () => {
  it('converts Asia/Shanghai midnight to the exact UTC cutoff', () => {
    expect(shanghaiMidnightToUtc('2026-07-19').toISOString()).toBe('2026-07-18T16:00:00.000Z');
  });

  it('rejects an impossible calendar date', () => {
    expect(() => shanghaiMidnightToUtc('2026-02-30')).toThrow('valid calendar date');
  });

  it('builds a count-bound confirmation text', () => {
    expect(eventLogClearConfirmation({ scope: 'all' }, 12)).toBe('确认清空全部日志（预计 12 条）');
    expect(eventLogClearConfirmation({ scope: 'beforeDate', beforeDate: '2026-07-19' }, 3))
      .toBe('确认清空 2026-07-19 前日志（预计 3 条）');
  });

  it('redacts bare and Bearer JWT values without changing ordinary dotted text', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const prisma = { eventLog: { create } };
    const service = new EventLogsService(prisma as unknown as PrismaService);

    await service.recordSafe({
      level: EventLogLevel.WARN,
      category: EventLogCategory.SECURITY,
      result: EventLogResult.FAILED,
      module: 'security',
      action: 'TOKEN_TEST',
      reason: `bare=${jwt}`,
      errorSummary: `failed Bearer ${jwt}`,
      metadata: {
        jwtText: `captured ${jwt}`,
        ordinary: 'version 1.2.3; domain api.example.com; dotted abc.def.ghi',
      },
    });

    const data = create.mock.calls[0]?.[0].data;
    expect(data?.reason).toBe('bare=[REDACTED]');
    expect(data?.errorSummary).toBe('failed Bearer [REDACTED]');
    expect(data?.metadata).toEqual({
      jwtText: 'captured [REDACTED]',
      ordinary: 'version 1.2.3; domain api.example.com; dotted abc.def.ghi',
    });
  });
  it('filters WeChat recipient and scene data from keys and free text', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const service = new EventLogsService({ eventLog: { create } } as unknown as PrismaService);
    await service.recordSafe({
      level: EventLogLevel.ERROR,
      category: EventLogCategory.SYSTEM,
      result: EventLogResult.FAILED,
      module: 'pickup_notifications',
      action: 'SENSITIVE_DATA_TEST',
      reason: 'openId=recipient scene=private-scene touser=recipient access_token=private-token',
      metadata: {
        openId: 'recipient',
        scene: 'private-scene',
        touser: 'recipient',
        access_token: 'private-token',
        safeTaskId: 'task-1',
      },
    });
    const data = create.mock.calls[0]?.[0].data;
    expect(data?.metadata).toEqual({ safeTaskId: 'task-1' });
    expect(data?.reason).toBe('openId=[REDACTED] scene=[REDACTED] touser=[REDACTED] access_token=[REDACTED]');
  });
  it('deletes first and inserts the governance summary in the same transaction', async () => {
    const operations: string[] = [];
    const tx = {
      eventLog: {
        count: jest.fn(async () => 2),
        deleteMany: jest.fn(async () => { operations.push('delete'); return { count: 2 }; }),
        create: jest.fn(async () => { operations.push('summary'); return { id: 'summary-id' }; }),
      },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EventLogsService(prisma as unknown as PrismaService);
    const result = await service.clear({
      scope: 'all', expectedCount: 2, confirmationText: '确认清空全部日志（预计 2 条）', reason: '测试清空日志',
    }, { id: '00000000-0000-0000-0000-000000000001', username: 'admin', displayName: 'Admin', role: UserRole.admin, tenantId: null, tenantIds: [] });
    expect(operations).toEqual(['delete', 'summary']);
    expect(result).toEqual({ deletedCount: 2, summaryLogId: 'summary-id' });
  });

  it('aborts when the count changed after preview', async () => {
    const tx = { eventLog: { count: jest.fn(async () => 3), deleteMany: jest.fn(), create: jest.fn() } };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new EventLogsService(prisma as unknown as PrismaService);
    await expect(service.clear({
      scope: 'all', expectedCount: 2, confirmationText: '确认清空全部日志（预计 2 条）', reason: '测试清空日志',
    }, { id: '00000000-0000-0000-0000-000000000001', username: 'admin', displayName: 'Admin', role: UserRole.admin, tenantId: null, tenantIds: [] }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.eventLog.deleteMany).not.toHaveBeenCalled();
  });
});