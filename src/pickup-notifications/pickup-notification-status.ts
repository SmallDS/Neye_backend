import { PickupNotificationTaskStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PickupKeywordMapping, WechatPickupNotificationSetting, validateWechatPickupNotification } from '../system-settings/wechat-pickup-notification';
import { WechatSubscribeMessageData } from '../wechat/wechat-api.client';
import { WechatApiError } from '../wechat/wechat-api.error';

export type PickupNotificationStatus = 'failed' | 'pending' | 'retrying' | 'sent' | 'unsubscribed';
export const PICKUP_NOTIFICATION_MAX_ATTEMPTS = 5;
export const PICKUP_NOTIFICATION_RETRY_MINUTES = [1, 5, 15, 60] as const;
export const PICKUP_NOTIFICATION_PAGE = 'pages/pickup-subscription/index';
export const PICKUP_NOTIFICATION_LEASE_MS = 60_000;
export const PICKUP_SCENE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createPickupScene(now = new Date()) {
  return {
    scene: randomBytes(24).toString('base64url'),
    expiresAt: new Date(now.getTime() + PICKUP_SCENE_TTL_MS),
  };
}

export interface PickupProjectionInput {
  readyForPickupAt?: Date | null;
  pickupScene?: { expiresAt: Date } | null;
  pickupSubscription?: { subscribedAt: Date; lockedAt?: Date | null } | null;
  pickupNotificationTask?: {
    id: string;
    status: PickupNotificationTaskStatus;
    totalAttempts: number;
    nextAttemptAt: Date;
    sentAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorSummary?: string | null;
  } | null;
}

export function retryDelayMs(attemptInCycle: number) {
  const minutes = PICKUP_NOTIFICATION_RETRY_MINUTES[attemptInCycle - 1];
  return minutes === undefined ? null : minutes * 60_000;
}
export function leaseRecoverySchedule(attemptInCycle: number, recoveredAt: Date) {
  const delay = retryDelayMs(attemptInCycle);
  const retrying = delay !== null && attemptInCycle < PICKUP_NOTIFICATION_MAX_ATTEMPTS;
  const nextRetryAt = retrying ? new Date(recoveredAt.getTime() + delay) : null;
  return { retrying, nextRetryAt };
}

export function projectPickupNotification(
  order: PickupProjectionInput,
  setting: WechatPickupNotificationSetting,
) {
  const subscription = order.pickupSubscription;
  const task = order.pickupNotificationTask;
  let status: PickupNotificationStatus = 'unsubscribed';
  let failureCode: string | null = null;
  let failureSummary: string | null = null;
  if (subscription) {
    if (task?.status === PickupNotificationTaskStatus.retrying) status = 'retrying';
    else if (task?.status === PickupNotificationTaskStatus.sent) status = 'sent';
    else if (task?.status === PickupNotificationTaskStatus.failed) status = 'failed';
    else if (task || !order.readyForPickupAt) status = 'pending';
    else {
      status = 'failed';
      const invalid = validateWechatPickupNotification(setting).length > 0;
      failureCode = setting.enabled ? (invalid ? 'CONFIG_INVALID' : 'TASK_NOT_CREATED') : 'CONFIG_DISABLED';
      failureSummary = setting.enabled ? (invalid ? '取镜通知配置无效' : '发送任务尚未创建') : '取镜通知功能未启用';
    }
  }
  return {
    status,
    receiverSubscribed: Boolean(subscription),
    receiverLocked: Boolean(subscription?.lockedAt),
    subscribedAt: subscription?.subscribedAt ?? null,
    attempts: task?.totalAttempts ?? 0,
    maxAttemptsPerCycle: PICKUP_NOTIFICATION_MAX_ATTEMPTS,
    nextRetryAt: task?.status === PickupNotificationTaskStatus.retrying ? task.nextAttemptAt : null,
    sentAt: task?.sentAt ?? null,
    failureCode: task?.lastErrorCode ?? failureCode,
    failureSummary: task?.lastErrorSummary ?? failureSummary,
    qrExpiresAt: order.pickupScene?.expiresAt ?? null,
  };
}

export function buildWechatPickupData(
  mapping: PickupKeywordMapping[],
  values: { orderNo: string; storeName: string; storePhone?: string | null; pickupTip: string },
): WechatSubscribeMessageData {
  const storePhone = values.storePhone?.trim();
  if (!storePhone) throw new WechatApiError('configuration', '门店联系电话未配置，无法发送取镜通知');
  const storePhoneMapping = mapping.find((item) => item.source === 'store_phone');
  if (!storePhoneMapping || !/^phone_number\d+$/.test(storePhoneMapping.keyword)) {
    throw new WechatApiError('configuration', '门店电话关键词配置无效，必须使用 phone_numberXX');
  }
  const sourceValues: Record<string, string> = {
    order_no: values.orderNo,
    store_name: values.storeName,
    store_phone: storePhone,
    pickup_tip: values.pickupTip,
  };
  return Object.fromEntries(mapping.map((item) => [item.keyword, { value: sourceValues[item.source] }])) as WechatSubscribeMessageData;
}