export const WECHAT_PICKUP_NOTIFICATION_KEY = 'wechat_pickup_notification';
export const PICKUP_NOTIFICATION_SOURCES = ['order_no', 'store_name', 'store_phone', 'pickup_tip'] as const;
export type PickupNotificationSource = (typeof PICKUP_NOTIFICATION_SOURCES)[number];
export interface PickupKeywordMapping { keyword: string; source: PickupNotificationSource; }
export interface WechatPickupNotificationSetting { enabled: boolean; templateId: string; pickupTip: string; keywordMapping: PickupKeywordMapping[]; }

export const DEFAULT_WECHAT_PICKUP_NOTIFICATION: WechatPickupNotificationSetting = {
  enabled: false,
  templateId: '',
  pickupTip: '您的眼镜已制作完成，请到店取镜',
  keywordMapping: [
    { keyword: 'character_string1', source: 'order_no' },
    { keyword: 'name2', source: 'store_name' },
    { keyword: 'phone_number3', source: 'store_phone' },
    { keyword: 'thing4', source: 'pickup_tip' },
  ],
};

const KEYWORD_PATTERN = /^(?:thing|character_string|time|date|number|name|phone_number)\d+$/;
const PHONE_KEYWORD_PATTERN = /^phone_number\d+$/;

export function normalizeWechatPickupNotification(value: unknown): WechatPickupNotificationSetting {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rowsBySource = new Map<PickupNotificationSource, PickupKeywordMapping>();
  let migratedLegacyPickupTime = false;
  if (Array.isArray(source.keywordMapping)) {
    for (const item of source.keywordMapping) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const keyword = typeof row.keyword === 'string' ? row.keyword.trim() : '';
      const mappedSource = typeof row.source === 'string' ? row.source : '';
      if (mappedSource === 'ready_for_pickup_at') {
        migratedLegacyPickupTime = true;
        continue;
      }
      if (PICKUP_NOTIFICATION_SOURCES.includes(mappedSource as PickupNotificationSource)) {
        const currentSource = mappedSource as PickupNotificationSource;
        if (!rowsBySource.has(currentSource)) rowsBySource.set(currentSource, { keyword, source: currentSource });
      }
    }
  }
  if (migratedLegacyPickupTime) rowsBySource.set('store_phone', { keyword: '', source: 'store_phone' });
  const mapping = PICKUP_NOTIFICATION_SOURCES.map((mappedSource) => {
    const existing = rowsBySource.get(mappedSource);
    if (existing) return existing;
    const fallback = DEFAULT_WECHAT_PICKUP_NOTIFICATION.keywordMapping.find((item) => item.source === mappedSource);
    return { ...fallback! };
  });
  return {
    enabled: source.enabled === true,
    templateId: typeof source.templateId === 'string' ? source.templateId.trim() : '',
    pickupTip: typeof source.pickupTip === 'string' ? source.pickupTip.trim() : DEFAULT_WECHAT_PICKUP_NOTIFICATION.pickupTip,
    keywordMapping: mapping,
  };
}

export function validateWechatPickupNotification(setting: WechatPickupNotificationSetting) {
  const errors: string[] = [];
  if (!setting.templateId) errors.push('模板 ID 不能为空');
  if (!setting.pickupTip || setting.pickupTip.length > 200) errors.push('取镜提示须为 1-200 个字符');
  if (setting.keywordMapping.length !== PICKUP_NOTIFICATION_SOURCES.length) errors.push('关键词映射必须包含四种数据源');
  const keywords = new Set<string>();
  const sources = new Set<PickupNotificationSource>();
  for (const item of setting.keywordMapping) {
    if (!KEYWORD_PATTERN.test(item.keyword)) errors.push(`关键词 ${item.keyword || '(空)'} 格式不正确`);
    if (item.source === 'store_phone' && !PHONE_KEYWORD_PATTERN.test(item.keyword)) errors.push('门店电话必须映射到 phone_numberXX 关键词');
    if (keywords.has(item.keyword)) errors.push(`关键词 ${item.keyword} 重复`);
    if (sources.has(item.source)) errors.push(`数据源 ${item.source} 重复`);
    keywords.add(item.keyword);
    sources.add(item.source);
  }
  for (const source of PICKUP_NOTIFICATION_SOURCES) if (!sources.has(source)) errors.push(`缺少数据源 ${source}`);
  return [...new Set(errors)];
}

export function pickupSettingResponse(setting: WechatPickupNotificationSetting) {
  const validationErrors = validateWechatPickupNotification(setting);
  return { ...setting, valid: validationErrors.length === 0, validationErrors };
}