import { HttpException } from '@nestjs/common';
import { InMemoryRateLimiter } from '../src/common/security/in-memory-rate-limiter';
import { EventLogsService } from '../src/event-logs/event-logs.service';
import {
  leaseRecoverySchedule,
  PICKUP_NOTIFICATION_LEASE_MS,
} from '../src/pickup-notifications/pickup-notification-status';
import {
  pickupPublicRateLimitKey,
  PublicPickupSubscriptionsController,
} from '../src/pickup-notifications/public-pickup-subscriptions.controller';
import { PickupNotificationsService } from '../src/pickup-notifications/pickup-notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_WECHAT_PICKUP_NOTIFICATION } from '../src/system-settings/wechat-pickup-notification';
import { WechatApiClient } from '../src/wechat/wechat-api.client';

const scene = 'A2345678901234567890123456789012';

describe('pickup notification QA regressions', () => {
  it('rate limits public endpoints with an IP and scene digest without leaking scene', async () => {
    const pickupNotifications = {
      getPublicContext: jest.fn(async () => ({ state: 'available' })),
      subscribe: jest.fn(async () => ({ status: 'subscribed' })),
    } as unknown as PickupNotificationsService;
    const controller = new PublicPickupSubscriptionsController(
      pickupNotifications,
      new InMemoryRateLimiter(),
    );
    const digestKey = pickupPublicRateLimitKey('203.0.113.10', scene);
    expect(digestKey).toMatch(/^203\.0\.113\.10:[a-f0-9]{64}$/);
    expect(digestKey).not.toContain(scene);

    for (let index = 0; index < 60; index += 1) {
      await controller.context({ scene }, '203.0.113.10');
    }
    try {
      await controller.context({ scene }, '203.0.113.10');
      throw new Error('Expected context rate limit');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect(JSON.stringify((error as HttpException).getResponse())).not.toContain(scene);
    }

    for (let index = 0; index < 10; index += 1) {
      await controller.subscribe({ scene, code: 'code', templateId: 'template-1' }, '203.0.113.11');
    }
    expect(() => controller.subscribe(
      { scene, code: 'code', templateId: 'template-1' },
      '203.0.113.11',
    )).toThrow(HttpException);
  });

  it('uses a 60-second lease and the standard retry backoff after recovery', () => {
    expect(PICKUP_NOTIFICATION_LEASE_MS).toBe(60_000);
    const recoveredAt = new Date('2026-07-20T00:00:00.000Z');
    expect(leaseRecoverySchedule(1, recoveredAt)).toEqual({
      retrying: true,
      nextRetryAt: new Date('2026-07-20T00:01:00.000Z'),
    });
    expect(leaseRecoverySchedule(4, recoveredAt)).toEqual({
      retrying: true,
      nextRetryAt: new Date('2026-07-20T01:00:00.000Z'),
    });
    expect(leaseRecoverySchedule(5, recoveredAt)).toEqual({
      retrying: false,
      nextRetryAt: null,
    });
  });

  it('keeps the original pre-ready snapshot for a repeated subscription by the same openid', async () => {
    const subscribedAt = new Date('2026-07-19T08:00:00.000Z');
    const upsert = jest.fn();
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: 'fitting-1' }]),
      fittingOrder: {
        findUnique: jest.fn(async () => ({
          id: 'fitting-1',
          tenantId: 'tenant-1',
          deletedAt: null,
          readyForPickupAt: null,
          pickupScene: { expiresAt: new Date('2026-08-01T00:00:00.000Z') },
          pickupSubscription: {
            id: 'subscription-1',
            openId: 'open-1',
            subscribedAt,
          },
          pickupNotificationTask: null,
        })),
      },
      fittingPickupSubscription: { upsert },
    };
    const prisma = {
      fittingPickupScene: {
        findUnique: jest.fn(async () => ({
          fittingOrderId: 'fitting-1',
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
          fittingOrder: { deletedAt: null, pickupSubscription: { lockedAt: null } },
        })),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const wechatApi = {
      exchangeMiniappCode: jest.fn(async () => ({ appId: 'wx-app', openId: 'open-1' })),
    } as unknown as WechatApiClient;
    const eventLogs = { recordSafe: jest.fn(async () => null) } as unknown as EventLogsService;
    const service = new PickupNotificationsService(prisma, wechatApi, eventLogs);
    jest.spyOn(service, 'getSettingState').mockResolvedValue({
      setting: { ...DEFAULT_WECHAT_PICKUP_NOTIFICATION, enabled: true, templateId: 'template-1' },
      usable: true,
      credentialsConfigured: true,
    });

    await expect(service.subscribe({ scene, code: 'code', templateId: 'template-1' })).resolves.toMatchObject({
      status: 'subscribed',
      subscribedAt,
      receiverLocked: false,
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});