import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WechatApiError, classifyWechatSendFailure, isWechatTokenInvalid } from './wechat-api.error';

const WECHAT_AUTH_KEY = 'wechat_auth';
const DEFAULT_WECHAT_TIMEOUT_MS = 8_000;

interface WechatCodeSessionResponse { openid?: string; errcode?: number; }
interface WechatTokenResponse { access_token?: string; expires_in?: number; errcode?: number; }
interface WechatSendResponse { errcode?: number; msgid?: number | string; }
interface WechatCredentials { appId: string; secret: string; envVersion: 'develop' | 'release' | 'trial'; }
export interface WechatSubscribeMessageData { [keyword: string]: { value: string }; }

@Injectable()
export class WechatApiClient {
  private readonly accessTokenCache = new Map<string, { token: string; expiresAt: number }>();
  private readonly accessTokenRequests = new Map<string, Promise<string>>();

  constructor(private readonly prisma: PrismaService) {}

  async exchangeMiniappCode(code: string) {
    const credentials = await this.getCredentials();
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', credentials.appId);
    url.searchParams.set('secret', credentials.secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await this.fetchWechat(url, {}, 'code exchange');
    const body = await this.readJson<WechatCodeSessionResponse>(response, 'code exchange');
    if (!response.ok || body.errcode || !body.openid) {
      if (body.errcode === 40029 || body.errcode === 40163) {
        throw new WechatApiError('invalid_code', '微信登录凭证无效或已使用', body.errcode);
      }
      throw new WechatApiError('temporary', '微信登录服务暂时不可用', body.errcode);
    }
    return { appId: credentials.appId, openId: body.openid };
  }

  async createUnlimitedQr(options: { scene: string; page: string; envVersion?: 'develop' | 'release' | 'trial' }) {
    const credentials = await this.getCredentials();
    const accessToken = await this.getAccessToken(credentials);
    const response = await this.fetchWechat(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: options.scene, page: options.page, check_path: false, env_version: options.envVersion ?? credentials.envVersion, width: 280 }),
      },
      'QR generation',
    );
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('application/json')) {
      let code: number | undefined;
      try { code = ((await response.json()) as { errcode?: number }).errcode; } catch { /* do not expose upstream body */ }
      throw new WechatApiError('permanent', '微信小程序码生成失败', code);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async sendSubscribeMessage(input: { openId: string; templateId: string; page: string; data: WechatSubscribeMessageData }): Promise<{ messageId?: string; tokenRefreshed: boolean }> {
    const credentials = await this.getCredentials();
    const first = await this.sendOnce(credentials, input);
    if (!isWechatTokenInvalid(first.code)) return this.requireSendSuccess(first, false);
    this.invalidateAccessToken(credentials);
    try {
      const second = await this.sendOnce(credentials, input);
      return this.requireSendSuccess(second, true);
    } catch (error) {
      if (error instanceof WechatApiError && !error.tokenRefreshed) {
        throw new WechatApiError(error.kind, error.safeMessage, error.wechatCode, true);
      }
      throw error;
    }
  }

  invalidateAccessToken(credentials?: WechatCredentials) {
    if (!credentials) { this.accessTokenCache.clear(); return; }
    this.accessTokenCache.delete(this.accessTokenCacheKey(credentials.appId, credentials.secret));
  }

  private async sendOnce(credentials: WechatCredentials, input: { openId: string; templateId: string; page: string; data: WechatSubscribeMessageData }) {
    const accessToken = await this.getAccessToken(credentials);
    const response = await this.fetchWechat(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ touser: input.openId, template_id: input.templateId, page: input.page, data: input.data }) },
      'subscribe message send',
    );
    const body = await this.readJson<WechatSendResponse>(response, 'subscribe message send');
    return { response, code: body.errcode, messageId: body.msgid === undefined ? undefined : String(body.msgid) };
  }

  private requireSendSuccess(result: { response: Response; code?: number; messageId?: string }, tokenRefreshed: boolean) {
    if (result.response.ok && (!result.code || result.code === 0)) return { messageId: result.messageId, tokenRefreshed };
    const classified = classifyWechatSendFailure(result.code, result.response.status);
    throw new WechatApiError(classified.kind, classified.summary, result.code, tokenRefreshed);
  }

  private async getCredentials(): Promise<WechatCredentials> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: WECHAT_AUTH_KEY } });
    const value = (setting?.value ?? {}) as Record<string, unknown>;
    const appId = typeof value.appId === 'string' ? value.appId.trim() : '';
    const secret = typeof value.appSecret === 'string' ? value.appSecret.trim() : '';
    if (!appId || !secret) throw new WechatApiError('configuration', '微信小程序凭据未配置');
    return { appId, secret, envVersion: value.envVersion === 'develop' || value.envVersion === 'trial' ? value.envVersion : 'release' };
  }

  private async getAccessToken(credentials: WechatCredentials) {
    const cacheKey = this.accessTokenCacheKey(credentials.appId, credentials.secret);
    const cached = this.accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const existing = this.accessTokenRequests.get(cacheKey);
    if (existing) return existing;
    const request = this.loadAccessToken(credentials, cacheKey).finally(() => this.accessTokenRequests.delete(cacheKey));
    this.accessTokenRequests.set(cacheKey, request);
    return request;
  }

  private async loadAccessToken(credentials: WechatCredentials, cacheKey: string) {
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', credentials.appId);
    url.searchParams.set('secret', credentials.secret);
    const response = await this.fetchWechat(url, {}, 'access token request');
    const body = await this.readJson<WechatTokenResponse>(response, 'access token request');
    if (!response.ok || body.errcode || !body.access_token) throw new WechatApiError('temporary', '微信访问令牌获取失败', body.errcode);
    this.pruneAccessTokenCache();
    this.accessTokenCache.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 7200) * 1000 });
    return body.access_token;
  }

  private async fetchWechat(input: string | URL, init: RequestInit, operation: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    catch (error) {
      const summary = error instanceof Error && error.name === 'AbortError' ? `微信${operation}超时` : `微信${operation}暂时不可用`;
      throw new WechatApiError('temporary', summary);
    } finally { clearTimeout(timeout); }
  }

  private async readJson<T>(response: Response, operation: string) {
    try { return (await response.json()) as T; }
    catch { throw new WechatApiError('temporary', `微信${operation}返回无效`); }
  }

  private timeoutMs() {
    const configured = Number(process.env.WECHAT_API_TIMEOUT_MS ?? DEFAULT_WECHAT_TIMEOUT_MS);
    return Number.isFinite(configured) ? Math.min(30_000, Math.max(1_000, configured)) : DEFAULT_WECHAT_TIMEOUT_MS;
  }

  private accessTokenCacheKey(appId: string, secret: string) { return `${appId}:${createHash('sha256').update(secret).digest('hex')}`; }
  private pruneAccessTokenCache() {
    const now = Date.now();
    for (const [key, item] of this.accessTokenCache) if (item.expiresAt <= now) this.accessTokenCache.delete(key);
    while (this.accessTokenCache.size >= 8) {
      const oldest = this.accessTokenCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.accessTokenCache.delete(oldest);
    }
  }
}