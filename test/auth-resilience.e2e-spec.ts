import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WechatLoginSessionPurpose, WechatLoginSessionStatus } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { WechatAuthService } from '../src/auth/wechat-auth.service';
import { InMemoryRateLimiter } from '../src/common/security/in-memory-rate-limiter';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { WechatApiClient } from '../src/wechat/wechat-api.client';

describe('Authentication resilience', () => {
  it('rejects requests after the in-memory limit is exhausted', () => {
    const limiter = new InMemoryRateLimiter();
    limiter.consume('login', 'Client-A', 2, 60_000);
    limiter.consume('login', 'client-a', 2, 60_000);

    try {
      limiter.consume('login', 'CLIENT-A', 2, 60_000);
      throw new Error('Expected rate limit error');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('confirms a scanned login exactly once with identity-bound conditions', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = { wechatLoginSession: { updateMany } } as unknown as PrismaService;
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        purpose: 'wechat-login-confirm',
        sessionId: 'session-1',
        userId: 'user-1',
        appId: 'wx-app',
        openId: 'open-1',
      }),
    } as unknown as JwtService;
    const service = new WechatAuthService(prisma, jwt, {} as AuthService, {} as WechatApiClient);
    const dto = { confirmationToken: 'signed-token', decision: 'confirm' as const };

    await expect(service.decideLoginSession('session-1', dto)).resolves.toEqual({
      status: 'web_confirmed',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'session-1',
          purpose: WechatLoginSessionPurpose.login,
          status: WechatLoginSessionStatus.binding_required,
          userId: 'user-1',
          openId: 'open-1',
        }),
        data: expect.objectContaining({ status: WechatLoginSessionStatus.confirmed }),
      }),
    );

    await expect(service.decideLoginSession('session-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('terminates a rejected scanned login without confirming it', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { wechatLoginSession: { updateMany } } as unknown as PrismaService;
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        purpose: 'wechat-login-confirm',
        sessionId: 'session-2',
        userId: 'user-2',
        appId: 'wx-app',
        openId: 'open-2',
      }),
    } as unknown as JwtService;
    const service = new WechatAuthService(prisma, jwt, {} as AuthService, {} as WechatApiClient);

    await expect(
      service.decideLoginSession('session-2', {
        confirmationToken: 'signed-token',
        decision: 'reject',
      }),
    ).resolves.toEqual({ status: 'web_rejected' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WechatLoginSessionStatus.consumed }),
      }),
    );
  });
});

describe('Health probes', () => {
  it('reports readiness only after a successful database query', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]) } as unknown as PrismaService;
    const controller = new HealthController(prisma);

    await expect(controller.ready()).resolves.toEqual(
      expect.objectContaining({ status: 'ok', checks: { database: 'ok' } }),
    );
  });

  it('returns service unavailable when the database query fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('offline')) } as unknown as PrismaService;
    const controller = new HealthController(prisma);

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
