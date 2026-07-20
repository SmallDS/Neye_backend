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
  normalizeWechatPickupNotification,
  validateWechatPickupNotification,
} from '../src/system-settings/wechat-pickup-notification';
import { WechatApiError, classifyWechatSendFailure, isWechatTokenInvalid } from '../src/wechat/wechat-api.error';

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

  it('supports name and phone keywords and builds store contact data', () => {
    const setting = {
      ...DEFAULT_WECHAT_PICKUP_NOTIFICATION,
      enabled: true,
      templateId: 'template-1',
      keywordMapping: DEFAULT_WECHAT_PICKUP_NOTIFICATION.keywordMapping.map((item) =>
        item.source === 'store_name' ? { ...item, keyword: 'name3' } : item,
      ),
    };
    expect(validateWechatPickupNotification(setting)).toEqual([]);
    expect(buildWechatPickupData(setting.keywordMapping, {
      orderNo: 'F001', storeName: '人民路店', storePhone: ' 021-12345678 ', pickupTip: '请到店取镜',
    })).toEqual({
      character_string1: { value: 'F001' },
      name3: { value: '人民路店' },
      phone_number3: { value: '021-12345678' },
      thing4: { value: '请到店取镜' },
    });
  });

  it('migrates the legacy pickup-time source to an invalid empty store-phone row', () => {
    const migrated = normalizeWechatPickupNotification({
      enabled: true,
      templateId: 'template-1',
      pickupTip: '请到店取镜',
      keywordMapping: [
        { keyword: 'character_string1', source: 'order_no' },
        { keyword: 'thing2', source: 'store_name' },
        { keyword: 'time3', source: 'ready_for_pickup_at' },
        { keyword: 'thing4', source: 'pickup_tip' },
      ],
    });
    expect(migrated.keywordMapping).toHaveLength(4);
    expect(migrated.keywordMapping.find((item) => item.source === 'store_phone')).toEqual({
      keyword: '', source: 'store_phone',
    });
    expect(validateWechatPickupNotification(migrated)).toContain(
      '门店电话必须映射到 phone_numberXX 关键词',
    );
  });

  it('rejects time keywords and missing values for the store phone', () => {
    const timeForPhone = {
      ...DEFAULT_WECHAT_PICKUP_NOTIFICATION,
      enabled: true,
      templateId: 'template-1',
      keywordMapping: DEFAULT_WECHAT_PICKUP_NOTIFICATION.keywordMapping.map((item) =>
        item.source === 'store_phone' ? { ...item, keyword: 'time3' } : item,
      ),
    };
    expect(validateWechatPickupNotification(timeForPhone)).toContain(
      '门店电话必须映射到 phone_numberXX 关键词',
    );    try {
      buildWechatPickupData(timeForPhone.keywordMapping, {
        orderNo: 'F001', storeName: '人民路店', storePhone: '021-12345678', pickupTip: '请到店取镜',
      });
      throw new Error('Expected invalid phone keyword error');
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'configuration',
        safeMessage: '门店电话关键词配置无效，必须使用 phone_numberXX',
      });
    }
    try {
      buildWechatPickupData(DEFAULT_WECHAT_PICKUP_NOTIFICATION.keywordMapping, {
        orderNo: 'F001', storeName: '人民路店', storePhone: ' ', pickupTip: '请到店取镜',
      });
      throw new Error('Expected missing store phone error');
    } catch (error) {
      expect(error).toBeInstanceOf(WechatApiError);
      expect(error).toMatchObject({
        kind: 'configuration',
        safeMessage: '门店联系电话未配置，无法发送取镜通知',
      });
    }
  });

  it('refreshes only known invalid-token codes and classifies refusal permanently', () => {
    expect([40001, 40014, 42001].every(isWechatTokenInvalid)).toBe(true);
    expect(isWechatTokenInvalid(43101)).toBe(false);
    expect(classifyWechatSendFailure(43101)).toMatchObject({ kind: 'permanent', code: 'SUBSCRIPTION_NOT_ACCEPTED' });
    expect(classifyWechatSendFailure(undefined, 503)).toMatchObject({ kind: 'temporary', code: 'WECHAT_5XX' });
  });
});