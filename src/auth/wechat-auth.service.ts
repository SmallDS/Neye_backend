import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  Prisma,
  UserRole,
  UserStatus,
  WechatLoginSessionPurpose,
  WechatLoginSessionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { WechatBindAccountDto } from './dto/wechat-bind-account.dto';
import { WechatMiniLoginDto } from './dto/wechat-mini-login.dto';
import { WechatSessionDecisionDto } from './dto/wechat-session-decision.dto';

const WECHAT_AUTH_KEY = 'wechat_auth';
const SESSION_TTL_MS = 2 * 60 * 1000;
const BINDING_TOKEN_TTL = '10m';
const CONFIRMATION_TOKEN_TTL = '3m';
const DEFAULT_WECHAT_TIMEOUT_MS = 8_000;

interface BindingTokenPayload {
  purpose: 'wechat-bind';
  appId: string;
  openId: string;
  scene?: string;
}

interface ConfirmationTokenPayload {
  purpose: 'wechat-login-confirm';
  sessionId: string;
  userId: string;
  appId: string;
  openId: string;
}

interface WechatCodeSession {
  openid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WechatAccessToken {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class WechatAuthService {
  private readonly accessTokenCache = new Map<string, { token: string; expiresAt: number }>();
  private readonly accessTokenRequests = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async getPublicConfig() {
    const config = await this.getConfig();
    return {
      enabled: config.enabled,
      appId: config.appId,
      secretConfigured: Boolean(config.secret),
    };
  }

  async createLoginSession() {
    return this.createSession(WechatLoginSessionPurpose.login);
  }

  async createBindingSession(currentUser: CurrentUser) {
    return this.createSession(WechatLoginSessionPurpose.bind, currentUser.id);
  }

  async pollSession(id: string) {
    const session = await this.prisma.wechatLoginSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Wechat login session not found');

    if (session.expiresAt <= new Date() && !this.isTerminal(session.status)) {
      await this.prisma.wechatLoginSession.updateMany({
        where: { id: session.id, status: session.status },
        data: { status: WechatLoginSessionStatus.expired },
      });
      return { status: WechatLoginSessionStatus.expired };
    }

    if (session.status !== WechatLoginSessionStatus.confirmed || !session.userId) {
      return { status: session.status };
    }

    if (session.purpose === WechatLoginSessionPurpose.bind) {
      return { status: WechatLoginSessionStatus.confirmed };
    }

    const consumed = await this.prisma.wechatLoginSession.updateMany({
      where: { id: session.id, status: WechatLoginSessionStatus.confirmed },
      data: { status: WechatLoginSessionStatus.consumed, consumedAt: new Date() },
    });
    if (consumed.count !== 1) return { status: WechatLoginSessionStatus.consumed };

    return {
      status: 'authenticated',
      ...(await this.authService.loginByUserId(session.userId)),
    };
  }

  async loginFromMiniapp(dto: WechatMiniLoginDto) {
    const identity = await this.exchangeCode(dto.code);
    const session = dto.scene ? await this.getActiveSession(dto.scene) : null;

    if (session?.purpose === WechatLoginSessionPurpose.bind) {
      if (!session.targetUserId) throw new BadRequestException('Binding session has no target account');
      await this.bindIdentity(session.targetUserId, identity.appId, identity.openId);
      await this.confirmBindingSession(session.id, session.targetUserId, identity.openId);
      return { status: 'web_confirmed' };
    }

    const binding = await this.prisma.userWechatBinding.findUnique({
      where: { appId_openId: { appId: identity.appId, openId: identity.openId } },
      include: { user: true },
    });

    if (!binding || binding.user.status !== UserStatus.active) {
      if (session) {
        const claimed = await this.prisma.wechatLoginSession.updateMany({
          where: {
            id: session.id,
            purpose: WechatLoginSessionPurpose.login,
            status: { in: [WechatLoginSessionStatus.pending, WechatLoginSessionStatus.binding_required] },
            userId: null,
            OR: [{ openId: null }, { openId: identity.openId }],
            expiresAt: { gt: new Date() },
          },
          data: { status: WechatLoginSessionStatus.binding_required, openId: identity.openId },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('Wechat login request was already scanned by another user');
        }
      }
      return {
        status: 'binding_required',
        bindingToken: await this.jwtService.signAsync(
          {
            purpose: 'wechat-bind',
            appId: identity.appId,
            openId: identity.openId,
            scene: session?.scene,
          } satisfies BindingTokenPayload,
          { expiresIn: BINDING_TOKEN_TTL as never },
        ),
      };
    }

    if (session) {
      return this.stageLoginConfirmation(
        session.id,
        binding.userId,
        binding.user.displayName,
        identity.appId,
        identity.openId,
      );
    }
    if (binding.user.role === UserRole.admin) {
      throw new ForbiddenException('Administrator accounts are not available in the mini program');
    }

    return {
      status: 'authenticated',
      ...(await this.authService.loginByUserId(binding.userId)),
    };
  }

  async bindAccount(dto: WechatBindAccountDto) {
    let payload: BindingTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<BindingTokenPayload>(dto.bindingToken);
    } catch {
      throw new UnauthorizedException('Wechat binding token is invalid or expired');
    }
    if (payload.purpose !== 'wechat-bind' || !payload.appId || !payload.openId) {
      throw new UnauthorizedException('Wechat binding token is invalid');
    }

    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: {
        tenantMemberships: {
          include: { tenant: true },
        },
      },
    });
    if (!user || user.status !== UserStatus.active || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.role === UserRole.staff && !user.tenantMemberships.some(({ tenant }) => tenant.status === 'active')) {
      throw new ForbiddenException('This account is not assigned to an active tenant');
    }
    if (user.role === UserRole.admin && !payload.scene) {
      throw new ForbiddenException('Administrator accounts are not available in the mini program');
    }

    await this.bindIdentity(user.id, payload.appId, payload.openId);
    if (payload.scene) {
      const session = await this.getActiveSession(payload.scene);
      if (session.purpose !== WechatLoginSessionPurpose.login) {
        throw new BadRequestException('Wechat login session purpose is invalid');
      }
      return this.stageLoginConfirmation(
        session.id,
        user.id,
        user.displayName,
        payload.appId,
        payload.openId,
      );
    }

    return {
      status: 'authenticated',
      ...(await this.authService.loginByUserId(user.id)),
    };
  }

  async decideLoginSession(id: string, dto: WechatSessionDecisionDto) {
    let payload: ConfirmationTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<ConfirmationTokenPayload>(dto.confirmationToken);
    } catch {
      throw new UnauthorizedException('Wechat confirmation token is invalid or expired');
    }
    if (
      payload.purpose !== 'wechat-login-confirm' ||
      payload.sessionId !== id ||
      !payload.userId ||
      !payload.appId ||
      !payload.openId
    ) {
      throw new UnauthorizedException('Wechat confirmation token is invalid');
    }

    const now = new Date();
    const commonWhere = {
      id,
      purpose: WechatLoginSessionPurpose.login,
      status: WechatLoginSessionStatus.binding_required,
      userId: payload.userId,
      openId: payload.openId,
      expiresAt: { gt: now },
    };
    const updated = await this.prisma.wechatLoginSession.updateMany({
      where: commonWhere,
      data:
        dto.decision === 'confirm'
          ? { status: WechatLoginSessionStatus.confirmed, confirmedAt: now }
          : { status: WechatLoginSessionStatus.consumed, consumedAt: now },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('Wechat login request has expired or was already decided');
    }

    return { status: dto.decision === 'confirm' ? 'web_confirmed' : 'web_rejected' };
  }

  async bindCurrentUser(currentUser: CurrentUser, code: string) {
    const identity = await this.exchangeCode(code);
    await this.bindIdentity(currentUser.id, identity.appId, identity.openId);
    return { bound: true };
  }

  async unbindCurrentUser(currentUser: CurrentUser) {
    const deleted = await this.prisma.userWechatBinding.deleteMany({
      where: { userId: currentUser.id },
    });
    return { bound: false, deleted: deleted.count > 0 };
  }

  private async createSession(purpose: WechatLoginSessionPurpose, targetUserId?: string) {
    const config = await this.requireEnabledConfig();
    const scene = randomBytes(18).toString('base64url');
    const session = await this.prisma.wechatLoginSession.create({
      data: {
        scene,
        purpose,
        targetUserId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    try {
      const qrCodeDataUrl = await this.createMiniappQrCode(
        config.appId,
        config.secret,
        config.envVersion,
        scene,
      );
      return {
        id: session.id,
        status: session.status,
        expiresAt: session.expiresAt,
        qrCodeDataUrl,
      };
    } catch (error) {
      await this.prisma.wechatLoginSession.delete({ where: { id: session.id } }).catch(() => undefined);
      throw error;
    }
  }

  private async exchangeCode(code: string) {
    const config = await this.requireEnabledConfig();
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', config.appId);
    url.searchParams.set('secret', config.secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await this.fetchWechat(url, {}, 'Wechat code exchange');
    const body = await this.readWechatJson<WechatCodeSession>(response, 'Wechat code exchange');
    if (!response.ok || body.errcode || !body.openid) {
      if (body.errcode === 40029 || body.errcode === 40163) {
        throw new UnauthorizedException('Wechat login code is invalid or already used');
      }
      throw new BadGatewayException(this.wechatApiError('Wechat code exchange', response, body.errcode));
    }
    return { appId: config.appId, openId: body.openid };
  }

  private async createMiniappQrCode(
    appId: string,
    secret: string,
    envVersion: 'develop' | 'release' | 'trial',
    scene: string,
  ) {
    const accessToken = await this.getAccessToken(appId, secret);
    const response = await this.fetchWechat(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene,
          page: 'pages/login/index',
          check_path: false,
          env_version: envVersion,
          width: 280,
        }),
      },
      'Wechat QR code generation',
    );
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('application/json')) {
      let errorCode: number | undefined;
      try {
        const body = (await response.json()) as { errcode?: number };
        errorCode = body.errcode;
      } catch {
        // The upstream may return a non-JSON error body. Do not expose it to clients.
      }
      throw new BadGatewayException(this.wechatApiError('Wechat QR code generation', response, errorCode));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }

  private async getAccessToken(appId: string, secret: string) {
    const cacheKey = this.accessTokenCacheKey(appId, secret);
    const cached = this.accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const existingRequest = this.accessTokenRequests.get(cacheKey);
    if (existingRequest) return existingRequest;

    const request = this.loadAccessToken(appId, secret, cacheKey).finally(() => {
      this.accessTokenRequests.delete(cacheKey);
    });
    this.accessTokenRequests.set(cacheKey, request);
    return request;
  }

  private async loadAccessToken(appId: string, secret: string, cacheKey: string) {
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', secret);
    const response = await this.fetchWechat(url, {}, 'Wechat access token request');
    const body = await this.readWechatJson<WechatAccessToken>(response, 'Wechat access token request');
    if (!response.ok || body.errcode || !body.access_token) {
      throw new BadGatewayException(this.wechatApiError('Wechat access token request', response, body.errcode));
    }
    this.pruneAccessTokenCache();
    this.accessTokenCache.set(cacheKey, {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 7200) * 1000,
    });
    return body.access_token;
  }

  private async fetchWechat(input: string | URL, init: RequestInit, operation: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.wechatTimeoutMs());
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(`${operation} timed out`);
      }
      throw new BadGatewayException(`${operation} could not reach Wechat`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readWechatJson<T>(response: Response, operation: string) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException(`${operation} returned an invalid response`);
    }
  }

  private wechatApiError(operation: string, response: Response, errorCode?: number) {
    const detail = errorCode === undefined ? `HTTP ${response.status}` : `code ${errorCode}`;
    return `${operation} failed (${detail})`;
  }

  private wechatTimeoutMs() {
    const configured = Number(process.env.WECHAT_API_TIMEOUT_MS ?? DEFAULT_WECHAT_TIMEOUT_MS);
    if (!Number.isFinite(configured)) return DEFAULT_WECHAT_TIMEOUT_MS;
    return Math.min(30_000, Math.max(1_000, configured));
  }

  private accessTokenCacheKey(appId: string, secret: string) {
    const secretFingerprint = createHash('sha256').update(secret).digest('hex');
    return `${appId}:${secretFingerprint}`;
  }

  private pruneAccessTokenCache() {
    const now = Date.now();
    for (const [key, cached] of this.accessTokenCache) {
      if (cached.expiresAt <= now) this.accessTokenCache.delete(key);
    }
    while (this.accessTokenCache.size >= 8) {
      const oldestKey = this.accessTokenCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.accessTokenCache.delete(oldestKey);
    }
  }

  private async getActiveSession(scene: string) {
    const session = await this.prisma.wechatLoginSession.findUnique({ where: { scene } });
    if (!session) throw new NotFoundException('Wechat login session not found');
    if (
      session.expiresAt <= new Date() ||
      (session.status !== WechatLoginSessionStatus.pending &&
        session.status !== WechatLoginSessionStatus.binding_required)
    ) {
      if (session.expiresAt <= new Date() && !this.isTerminal(session.status)) {
        await this.prisma.wechatLoginSession.updateMany({
          where: { id: session.id, status: session.status },
          data: { status: WechatLoginSessionStatus.expired },
        });
      }
      throw new BadRequestException('Wechat login session has expired or was already used');
    }
    return session;
  }

  private async stageLoginConfirmation(
    sessionId: string,
    userId: string,
    displayName: string,
    appId: string,
    openId: string,
  ) {
    const staged = await this.prisma.wechatLoginSession.updateMany({
      where: {
        id: sessionId,
        purpose: WechatLoginSessionPurpose.login,
        status: { in: [WechatLoginSessionStatus.pending, WechatLoginSessionStatus.binding_required] },
        userId: null,
        OR: [{ openId: null }, { openId }],
        expiresAt: { gt: new Date() },
      },
      data: {
        status: WechatLoginSessionStatus.binding_required,
        userId,
        openId,
      },
    });
    if (staged.count !== 1) {
      throw new BadRequestException('Wechat login request has expired or was already used');
    }

    return {
      status: 'confirmation_required',
      sessionId,
      accountName: displayName,
      confirmationToken: await this.jwtService.signAsync(
        {
          purpose: 'wechat-login-confirm',
          sessionId,
          userId,
          appId,
          openId,
        } satisfies ConfirmationTokenPayload,
        { expiresIn: CONFIRMATION_TOKEN_TTL as never },
      ),
    };
  }

  private async confirmBindingSession(id: string, userId: string, openId: string) {
    const confirmed = await this.prisma.wechatLoginSession.updateMany({
      where: {
        id,
        purpose: WechatLoginSessionPurpose.bind,
        status: { in: [WechatLoginSessionStatus.pending, WechatLoginSessionStatus.binding_required] },
        userId: null,
        OR: [{ openId: null }, { openId }],
        expiresAt: { gt: new Date() },
      },
      data: {
        status: WechatLoginSessionStatus.confirmed,
        userId,
        openId,
        confirmedAt: new Date(),
      },
    });
    if (confirmed.count !== 1) {
      throw new BadRequestException('Wechat binding request has expired or was already used');
    }
  }

  private async bindIdentity(userId: string, appId: string, openId: string) {
    const [byUser, byIdentity] = await Promise.all([
      this.prisma.userWechatBinding.findUnique({ where: { userId } }),
      this.prisma.userWechatBinding.findUnique({ where: { appId_openId: { appId, openId } } }),
    ]);
    if (byUser && (byUser.appId !== appId || byUser.openId !== openId)) {
      throw new ConflictException('This account is already bound to another Wechat user');
    }
    if (byIdentity && byIdentity.userId !== userId) {
      throw new ConflictException('This Wechat user is already bound to another account');
    }
    if (byUser || byIdentity) return;

    try {
      await this.prisma.userWechatBinding.create({ data: { userId, appId, openId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Wechat binding already exists');
      }
      throw error;
    }
  }

  private async requireEnabledConfig() {
    const config = await this.getConfig();
    if (!config.enabled) throw new ServiceUnavailableException('Wechat login is disabled');
    if (!config.appId || !config.secret) {
      throw new ServiceUnavailableException('Wechat mini program credentials are not configured');
    }
    return {
      appId: config.appId,
      secret: config.secret,
      envVersion: config.envVersion,
    };
  }

  private async getConfig() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: WECHAT_AUTH_KEY },
    });
    const value = (setting?.value ?? {}) as Record<string, unknown>;
    const envVersion: 'develop' | 'release' | 'trial' =
      value.envVersion === 'develop' || value.envVersion === 'trial'
        ? value.envVersion
        : 'release';
    return {
      enabled: value.enabled === true,
      appId: typeof value.appId === 'string' ? value.appId.trim() : '',
      secret: typeof value.appSecret === 'string' ? value.appSecret.trim() : '',
      envVersion,
    };
  }

  private isTerminal(status: WechatLoginSessionStatus) {
    return status === WechatLoginSessionStatus.consumed || status === WechatLoginSessionStatus.expired;
  }
}
