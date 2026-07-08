import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from './types/current-user';

export function tenantFilter(user: CurrentUser, requestedTenantId?: string | null) {
  const tenantId = requestedTenantId?.trim();
  if (user.role === UserRole.admin) {
    return tenantId ? { tenantId } : {};
  }

  if (!user.tenantId) {
    throw new BadRequestException('Tenant context is required');
  }
  if (tenantId && tenantId !== user.tenantId) {
    throw new ForbiddenException('Cannot access another tenant');
  }
  return { tenantId: user.tenantId };
}

export function requireTenantId(user: CurrentUser, requestedTenantId?: string | null): string {
  const tenantId = requestedTenantId?.trim() || user.tenantId || undefined;
  if (!tenantId) {
    throw new BadRequestException('Tenant context is required');
  }
  if (user.role !== UserRole.admin && tenantId !== user.tenantId) {
    throw new ForbiddenException('Cannot access another tenant');
  }
  return tenantId;
}