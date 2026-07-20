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
import { WechatApiClient } from '../wechat/wechat-api.client';
import { WechatApiError } from '../wechat/wechat-api.error';
import { AuthService } from './auth.service';
import { WechatBindAccountDto } from './dto/wechat-bind-account.dto';
import { WechatMiniLoginDto } from './dto/wechat-mini-login.dto';
import { WechatSessionDecisionDto } from './dto/wechat-session-decision.dto';

const WECHAT_AUTH_KEY = 'wechat_auth';
const SESSION_TTL_MS = 2 * 60 * 1000;
const BINDING_TOKEN_TTL = '10m';
const CONFIRMATION_TOKEN_TTL = '3m';

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

@Injectable()
export class WechatAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly wechatApi: WechatApiClient,
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
      const qrCodeDataUrl = await this.createMiniappQrCode(config.envVersion, scene);
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
    await this.requireEnabledConfig();
    try {
      return await this.wechatApi.exchangeMiniappCode(code);
    } catch (error) {
      if (error instanceof WechatApiError) {
        if (error.kind === 'invalid_code') throw new UnauthorizedException(error.safeMessage);
        if (error.kind === 'configuration') throw new ServiceUnavailableException(error.safeMessage);
        throw new BadGatewayException(error.safeMessage);
      }
      throw error;
    }
  }

  private async createMiniappQrCode(
    envVersion: 'develop' | 'release' | 'trial',
    scene: string,
  ) {
    try {
      const bytes = await this.wechatApi.createUnlimitedQr({
        scene,
        page: 'pages/login/index',
        envVersion,
      });
      return `data:image/png;base64,${bytes.toString('base64')}`;
    } catch (error) {
      if (error instanceof WechatApiError) {
        if (error.kind === 'configuration') throw new ServiceUnavailableException(error.safeMessage);
        throw new BadGatewayException(error.safeMessage);
      }
      throw error;
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
