export type WechatApiErrorKind = 'configuration' | 'invalid_code' | 'permanent' | 'temporary';

export class WechatApiError extends Error {
  constructor(
    readonly kind: WechatApiErrorKind,
    readonly safeMessage: string,
    readonly wechatCode?: number,
    readonly tokenRefreshed = false,
  ) {
    super(safeMessage);
    this.name = 'WechatApiError';
  }
}

const TOKEN_INVALID_CODES = new Set([40001, 40014, 42001]);
const TEMPLATE_ERROR_CODES = new Set([40037, 41030, 43101, 47003]);

export function isWechatTokenInvalid(code?: number) {
  return code !== undefined && TOKEN_INVALID_CODES.has(code);
}

export function classifyWechatSendFailure(code?: number, httpStatus = 200) {
  if (httpStatus >= 500) {
    return { kind: 'temporary' as const, code: 'WECHAT_5XX', summary: '微信服务暂时不可用' };
  }
  if (code === 43101) {
    return { kind: 'permanent' as const, code: 'SUBSCRIPTION_NOT_ACCEPTED', summary: '用户未授权接收本次订阅消息' };
  }
  if (code !== undefined && TEMPLATE_ERROR_CODES.has(code)) {
    return { kind: 'permanent' as const, code: 'WECHAT_TEMPLATE_INVALID', summary: '微信模板或字段配置无效' };
  }
  if (code !== undefined && code !== 0) {
    return { kind: 'permanent' as const, code: 'WECHAT_REJECTED', summary: '微信拒绝发送订阅消息' };
  }
  return { kind: 'temporary' as const, code: 'WECHAT_NETWORK', summary: '微信服务暂时不可用' };
}