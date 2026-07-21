import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { toPageResult } from '../common/dto/page.dto';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { AssignUserTenantsDto } from './dto/assign-user-tenants.dto';
import { BatchUserStatusDto } from './dto/batch-user-status.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

const accountSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  username: true,
  displayName: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  tenantMemberships: {
    select: {
      assignedAt: true,
      tenant: true,
    },
    orderBy: { assignedAt: 'asc' },
  },
});

type AccountRecord = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { username: { contains: query.keyword, mode: 'insensitive' } },
              { displayName: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: accountSelect,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return toPageResult(items.map((item) => this.serialize(item)), total, query);
  }

  async get(id: string) {
    return this.serialize(await this.findAccount(id));
  }

  async create(dto: CreateUserDto) {
    const tenantIds = [...new Set(dto.tenantIds ?? [])];
    const role = dto.role ?? UserRole.staff;
    if (role === UserRole.admin && tenantIds.length > 0) {
      throw new BadRequestException('Admin accounts do not need tenant assignments');
    }
    await this.ensureTenants(tenantIds);
    const existed = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existed) throw new ConflictException('Account username already exists');
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: dto.username,
          passwordHash,
          displayName: dto.displayName,
          role,
          tenantMemberships: tenantIds.length ? { create: tenantIds.map((tenantId) => ({ tenantId })) } : undefined,
        },
        select: accountSelect,
      });
      return created;
    });
    return this.serialize(account);
  }
  async update(actor: CurrentUser, id: string, dto: UpdateUserDto) {
    const current = await this.findAccount(id);
    const disablesAdmin =
      current.role === UserRole.admin &&
      current.status === UserStatus.active &&
      (dto.status === UserStatus.disabled || dto.role === UserRole.staff);
    if (actor.id === id && disablesAdmin) {
      throw new BadRequestException('Cannot disable or demote the current admin account');
    }

    const account = await this.prisma.$transaction(async (tx) => {
      if (disablesAdmin) await this.ensureAnotherActiveAdmin(tx, [id]);
      if (dto.role === UserRole.admin && current.role !== UserRole.admin) {
        await tx.userTenant.deleteMany({ where: { userId: id } });
      }
      const updated = await tx.user.update({ where: { id }, data: dto, select: accountSelect });
      if (dto.role !== undefined || dto.status !== undefined) {
      }
      return updated;
    });
    return this.serialize(account);
  }

  async batchStatus(actor: CurrentUser, dto: BatchUserStatusDto) {
    const userIds = [...new Set(dto.userIds)];
    if (dto.status === UserStatus.disabled && userIds.includes(actor.id)) {
      throw new BadRequestException('Cannot disable the current admin account');
    }
    return this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, status: true } });
      if (users.length !== userIds.length) throw new NotFoundException('Some accounts are not found');
      const disabledActiveAdminIds = users
        .filter((user) => user.role === UserRole.admin && user.status === UserStatus.active && dto.status === UserStatus.disabled)
        .map((user) => user.id);
      if (disabledActiveAdminIds.length > 0) await this.ensureAnotherActiveAdmin(tx, disabledActiveAdminIds);

      const result = await tx.user.updateMany({ where: { id: { in: userIds } }, data: { status: dto.status } });
      return { updatedCount: result.count, status: dto.status, userIds };
    });
  }

  async resetPassword(id: string, dto: ResetUserPasswordDto) {
    const account = await this.findAccount(id);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
    });
    return { userId: id, username: account.username };
  }

  async replaceTenants(id: string, dto: AssignUserTenantsDto) {
    const account = await this.findAccount(id);
    if (account.role === UserRole.admin) {
      throw new BadRequestException('Admin accounts do not need tenant assignments');
    }

    const tenantIds = [...new Set(dto.tenantIds)];
    await this.ensureTenants(tenantIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.userTenant.deleteMany({
        where: { userId: id, ...(tenantIds.length ? { tenantId: { notIn: tenantIds } } : {}) },
      });
      for (const tenantId of tenantIds) {
        await tx.userTenant.upsert({
          where: { userId_tenantId: { userId: id, tenantId } },
          create: { userId: id, tenantId },
          update: {},
        });
      }
    });
    return this.get(id);
  }
  private async ensureAnotherActiveAdmin(tx: Prisma.TransactionClient, excludedIds: string[]) {
    // The lock function returns PostgreSQL void, which Prisma cannot deserialize through $queryRaw.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(74239001)`;
    const remaining = await tx.user.count({
      where: { role: UserRole.admin, status: UserStatus.active, id: { notIn: excludedIds } },
    });
    if (remaining === 0) throw new BadRequestException('At least one active admin account must remain');
  }

  private async findAccount(id: string) {
    const account = await this.prisma.user.findUnique({
      where: { id },
      select: accountSelect,
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  private async ensureTenants(tenantIds: string[]) {
    if (tenantIds.length === 0) return;
    const count = await this.prisma.tenant.count({ where: { id: { in: tenantIds } } });
    if (count !== tenantIds.length) {
      throw new BadRequestException('Some assigned tenants do not exist');
    }
  }

  private serialize(account: AccountRecord) {
    const { tenantMemberships, ...profile } = account;
    return {
      ...profile,
      tenants: tenantMemberships.map(({ assignedAt, tenant }) => ({
        ...tenant,
        assignedAt,
      })),
    };
  }
}
