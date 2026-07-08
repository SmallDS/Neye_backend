import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../types/current-user';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: CurrentUser }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: CurrentUser;
    try {
      payload = this.jwtService.verify<CurrentUser>(authorization.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.id },
      include: { tenant: true },
    });
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    if (user.role !== UserRole.admin && user.tenant?.status !== TenantStatus.active) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    request.user = {
      id: user.id,
      tenantId: user.tenantId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
    return true;
  }
}