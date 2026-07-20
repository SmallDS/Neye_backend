import { PickupNotificationTaskStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PickupKeywordMapping, WechatPickupNotificationSetting, validateWechatPickupNotification } from '../system-settings/wechat-pickup-notification';
import { WechatSubscribeMessageData } from '../wechat/wechat-api.client';

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

export function formatWechatPickupTime(value: Date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function buildWechatPickupData(
  mapping: PickupKeywordMapping[],
  values: { orderNo: string; storeName: string; readyForPickupAt: Date; pickupTip: string },
): WechatSubscribeMessageData {
  const sourceValues: Record<string, string> = {
    order_no: values.orderNo,
    store_name: values.storeName,
    ready_for_pickup_at: formatWechatPickupTime(values.readyForPickupAt),
    pickup_tip: values.pickupTip,
  };
  return Object.fromEntries(mapping.map((item) => [item.keyword, { value: sourceValues[item.source] }])) as WechatSubscribeMessageData;
}