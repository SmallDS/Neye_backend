import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../types/current-user';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUser }>();
    if (request.user?.role === UserRole.admin) {
      return true;
    }
    if (!request.user?.tenantId) {
      throw new ForbiddenException('Tenant context is required');
    }
    return true;
  }
}