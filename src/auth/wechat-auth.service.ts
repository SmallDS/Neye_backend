import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { randomBytes } from 'crypto';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSettingSecret } from '../system-settings/secret-crypto';
import { AuthService } from './auth.service';
import { WechatBindAccountDto } from './dto/wechat-bind-account.dto';
import { WechatMiniLoginDto } from './dto/wechat-mini-login.dto';

const WECHAT_AUTH_KEY = 'wechat_auth';
const SESSION_TTL_MS = 2 * 60 * 1000;
const BINDING_TOKEN_TTL = '10m';

interface BindingTokenPayload {
  purpose: 'wechat-bind';
  appId: string;
  openId: string;
  scene?: string;
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
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

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
      await this.prisma.wechatLoginSession.update({
        where: { id: session.id },
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
      await this.confirmSession(session.id, session.targetUserId, identity.openId);
      return { status: 'web_confirmed' };
    }

    const binding = await this.prisma.userWechatBinding.findUnique({
      where: { appId_openId: { appId: identity.appId, openId: identity.openId } },
      include: { user: true },
    });

    if (!binding || binding.user.status !== UserStatus.active) {
      if (session) {
        await this.prisma.wechatLoginSession.update({
          where: { id: session.id },
          data: { status: WechatLoginSessionStatus.binding_required, openId: identity.openId },
        });
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

    if (session) await this.confirmSession(session.id, binding.userId, identity.openId);
    if (binding.user.role === UserRole.admin) {
      if (session) return { status: 'web_confirmed' };
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
      await this.confirmSession(session.id, user.id, payload.openId);
    }

    if (user.role === UserRole.admin) return { status: 'web_confirmed' };
    return {
      status: 'authenticated',
      ...(await this.authService.loginByUserId(user.id)),
    };
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
      const qrCodeDataUrl = await this.createMiniappQrCode(config.appId, config.secret, scene);
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
    const response = await fetch(url);
    const body = (await response.json()) as WechatCodeSession;
    if (!response.ok || body.errcode || !body.openid) {
      throw new UnauthorizedException(`Wechat login failed: ${body.errmsg ?? body.errcode ?? response.status}`);
    }
    return { appId: config.appId, openId: body.openid };
  }

  private async createMiniappQrCode(appId: string, secret: string, scene: string) {
    const accessToken = await this.getAccessToken(appId, secret);
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene,
          page: 'pages/login/index',
          check_path: false,
          env_version: this.wechatEnvVersion(),
          width: 280,
        }),
      },
    );
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('application/json')) {
      const body = await response.text();
      throw new BadGatewayException(`Wechat QR code generation failed: ${body.slice(0, 200)}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }

  private async getAccessToken(appId: string, secret: string) {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now() + 60_000) {
      return this.cachedAccessToken.token;
    }
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', secret);
    const response = await fetch(url);
    const body = (await response.json()) as WechatAccessToken;
    if (!response.ok || body.errcode || !body.access_token) {
      throw new BadGatewayException(`Wechat access token failed: ${body.errmsg ?? body.errcode ?? response.status}`);
    }
    this.cachedAccessToken = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 7200) * 1000,
    };
    return body.access_token;
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
        await this.prisma.wechatLoginSession.update({
          where: { id: session.id },
          data: { status: WechatLoginSessionStatus.expired },
        });
      }
      throw new BadRequestException('Wechat login session has expired');
    }
    return session;
  }

  private async confirmSession(id: string, userId: string, openId: string) {
    await this.prisma.wechatLoginSession.update({
      where: { id },
      data: {
        status: WechatLoginSessionStatus.confirmed,
        userId,
        openId,
        confirmedAt: new Date(),
      },
    });
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
    return { appId: config.appId, secret: config.secret };
  }

  private async getConfig() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: WECHAT_AUTH_KEY },
    });
    const value = (setting?.value ?? {}) as Record<string, unknown>;
    let databaseSecret = '';
    if (
      typeof value.encryptedSecret === 'string' &&
      value.encryptedSecret.length > 0
    ) {
      try {
        databaseSecret = decryptSettingSecret(value.encryptedSecret);
      } catch {
        throw new ServiceUnavailableException(
          'Wechat AppSecret cannot be decrypted; check SETTINGS_ENCRYPTION_KEY',
        );
      }
    }
    return {
      enabled: value.enabled === true,
      appId:
        typeof value.appId === 'string' && value.appId.trim()
          ? value.appId.trim()
          : (process.env.WECHAT_MINIAPP_APP_ID ?? ''),
      secret:
        databaseSecret || process.env.WECHAT_MINIAPP_APP_SECRET || '',
    };
  }

  private wechatEnvVersion() {
    const value = process.env.WECHAT_MINIAPP_ENV_VERSION;
    return value === 'develop' || value === 'trial' || value === 'release' ? value : 'release';
  }

  private isTerminal(status: WechatLoginSessionStatus) {
    return status === WechatLoginSessionStatus.consumed || status === WechatLoginSessionStatus.expired;
  }
}
