import { PickupNotificationTaskStatus } from '@prisma/client';
import {
  buildWechatPickupData,
  createPickupScene,
  PICKUP_SCENE_TTL_MS,
  projectPickupNotification,
  retryDelayMs,
} from '../src/pickup-notifications/pickup-notification-status';
import {
  DEFAULT_WECHAT_PICKUP_NOTIFICATION,
  validateWechatPickupNotification,
} from '../src/system-settings/wechat-pickup-notification';
import { classifyWechatSendFailure, isWechatTokenInvalid } from '../src/wechat/wechat-api.error';

describe('pickup notification policy', () => {
  it('uses a high-entropy 32-character scene with a 30-day expiry', () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    const first = createPickupScene(now);
    const second = createPickupScene(now);
    expect(first.scene).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second.scene).not.toBe(first.scene);
    expect(first.expiresAt.getTime() - now.getTime()).toBe(PICKUP_SCENE_TTL_MS);
  });

  it('applies the exact retry schedule and stops after the fifth attempt', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([
      60_000, 300_000, 900_000, 3_600_000, null,
    ]);
  });

  it('projects subscription and task states without exposing recipient data', () => {
    const projection = projectPickupNotification({
      readyForPickupAt: new Date(),
      pickupSubscription: { subscribedAt: new Date(), lockedAt: new Date() },
      pickupNotificationTask: {
        id: 'task-1',
        status: PickupNotificationTaskStatus.failed,
        totalAttempts: 5,
        nextAttemptAt: new Date(),
        lastErrorCode: 'WECHAT_43101',
        lastErrorSummary: '用户未授权接收本次订阅消息',
      },
    }, { ...DEFAULT_WECHAT_PICKUP_NOTIFICATION, enabled: true, templateId: 'template-1' });
    expect(projection).toMatchObject({ status: 'failed', receiverSubscribed: true, receiverLocked: true, attempts: 5 });
    expect(JSON.stringify(projection)).not.toMatch(/openid|scene|touser/i);
  });

  it('builds all four whitelisted template values from the subscription snapshot', () => {
    const setting = { ...DEFAULT_WECHAT_PICKUP_NOTIFICATION, enabled: true, templateId: 'template-1' };
    expect(validateWechatPickupNotification(setting)).toEqual([]);
    expect(buildWechatPickupData(setting.keywordMapping, {
      orderNo: 'F001', storeName: '人民路店', readyForPickupAt: new Date('2026-07-20T08:30:00.000Z'), pickupTip: '请到店取镜',
    })).toEqual({
      character_string1: { value: 'F001' }, thing2: { value: '人民路店' }, time3: { value: '2026-07-20 16:30' }, thing4: { value: '请到店取镜' },
    });
  });

  it('refreshes only known invalid-token codes and classifies refusal permanently', () => {
    expect([40001, 40014, 42001].every(isWechatTokenInvalid)).toBe(true);
    expect(isWechatTokenInvalid(43101)).toBe(false);
    expect(classifyWechatSendFailure(43101)).toMatchObject({ kind: 'permanent', code: 'SUBSCRIPTION_NOT_ACCEPTED' });
    expect(classifyWechatSendFailure(undefined, 503)).toMatchObject({ kind: 'temporary', code: 'WECHAT_5XX' });
  });
});