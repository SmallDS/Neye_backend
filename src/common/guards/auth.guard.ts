import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../types/current-user';

interface JwtPayload {
  id: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: CurrentUser;
    }>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(authorization.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.id },
      include: {
        tenant: true,
        tenantMemberships: {
          include: { tenant: true },
          orderBy: { assignedAt: 'asc' },
        },
      },
    });
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    if (user.tenantId && !user.tenantMemberships.some((membership) => membership.tenantId === user.tenantId)) {
      await this.prisma.userTenant.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: user.tenantId } },
        create: { userId: user.id, tenantId: user.tenantId },
        update: {},
      });
      if (user.tenant?.status === TenantStatus.active) {
        user.tenantMemberships.push({
          userId: user.id,
          tenantId: user.tenantId,
          assignedAt: user.createdAt,
          tenant: user.tenant,
        });
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { tenantId: null },
      });
    }

    const activeTenantIds = user.tenantMemberships
      .filter((membership) => membership.tenant.status === TenantStatus.active)
      .map((membership) => membership.tenantId);
    const requestedHeader = request.headers['x-tenant-id'];
    const requestedTenantId = Array.isArray(requestedHeader) ? requestedHeader[0] : requestedHeader;
    let tenantId: string | null = null;

    if (user.role !== UserRole.admin) {
      if (requestedTenantId && !activeTenantIds.includes(requestedTenantId)) {
        throw new ForbiddenException('Cannot access an unassigned tenant');
      }
      tenantId = requestedTenantId || activeTenantIds[0] || null;
    }

    request.user = {
      id: user.id,
      tenantId,
      tenantIds: activeTenantIds,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
    return true;
  }
}