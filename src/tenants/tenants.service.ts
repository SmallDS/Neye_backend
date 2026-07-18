import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createOrderNo } from '../common/order-number';
import { toPageResult } from '../common/dto/page.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { BatchTenantDeleteDto } from './dto/dangerous-tenant-operation.dto';
import { ResetTenantUserPasswordDto } from './dto/reset-tenant-user-password.dto';
import { TenantQueryDto } from './dto/tenant-query.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

const userSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  username: true,
  displayName: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  private initialAccount(dto: CreateTenantDto): { displayName: string; password: string; username: string } | undefined {
    const username = dto.accountUsername ?? dto.adminUsername;
    const password = dto.accountPassword ?? dto.adminPassword;
    const displayName = dto.accountDisplayName ?? dto.adminDisplayName;
    const hasAny = Boolean(username || password || displayName);
    if (!hasAny) return undefined;
    if (!username || !password || !displayName) {
      throw new BadRequestException('Tenant account username, password and displayName are required together');
    }
    return { username, password, displayName };
  }

  private async ensureTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async list(query: TenantQueryDto) {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? { OR: [{ name: { contains: query.keyword } }, { code: { contains: query.keyword } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return toPageResult(items, total, query);
  }

  async get(id: string) {
    const tenant = await this.ensureTenant(id);
    const [memberships, customersCount, optometryOrdersCount, fittingOrdersCount, recentCustomers, recentOptometryOrders, recentFittingOrders] =
      await this.prisma.$transaction([
        this.prisma.userTenant.findMany({
          where: { tenantId: id },
          include: { user: { select: userSelect } },
          orderBy: { assignedAt: 'desc' },
        }),
        this.prisma.customer.count({ where: { tenantId: id, deletedAt: null } }),
        this.prisma.optometryOrder.count({ where: { tenantId: id, deletedAt: null } }),
        this.prisma.fittingOrder.count({ where: { tenantId: id, deletedAt: null } }),
        this.prisma.customer.findMany({ where: { tenantId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 8 }),
        this.prisma.optometryOrder.findMany({
          where: { tenantId: id, deletedAt: null },
          include: { customer: true },
          orderBy: { optometryDate: 'desc' },
          take: 8,
        }),
        this.prisma.fittingOrder.findMany({
          where: { tenantId: id, deletedAt: null },
          include: { customer: true, optometryOrder: true },
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
      ]);

    const users = memberships.map((membership) => this.serializeMembership(membership));
    return {
      ...tenant,
      counts: {
        users: users.length,
        customers: customersCount,
        optometryOrders: optometryOrdersCount,
        fittingOrders: fittingOrdersCount,
      },
      users,
      recentCustomers,
      recentOptometryOrders,
      recentFittingOrders,
    };
  }

  async create(dto: CreateTenantDto) {
    const account = this.initialAccount(dto);
    if (account) {
      const existed = await this.prisma.user.findUnique({ where: { username: account.username } });
      if (existed) throw new ConflictException('Account username already exists');
    }
    const passwordHash = account ? await bcrypt.hash(account.password, 10) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          code: createOrderNo('T'),
          name: dto.name,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
        },
      });
      const user = account && passwordHash
        ? await tx.user.create({
            data: {
              username: account.username,
              passwordHash,
              displayName: account.displayName,
              role: UserRole.staff,
              tenantMemberships: { create: { tenantId: tenant.id } },
            },
            select: userSelect,
          })
        : undefined;
      return { tenantId: tenant.id, tenantCode: tenant.code, accountUserId: user?.id };
    });
  }
  async update(id: string, dto: UpdateTenantDto) {
    await this.ensureTenant(id);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({ where: { id }, data: dto });
      return tenant;
    });
  }
  async listUsers(id: string) {
    await this.ensureTenant(id);
    const memberships = await this.prisma.userTenant.findMany({
      where: { tenantId: id },
      include: { user: { select: userSelect } },
      orderBy: { assignedAt: 'desc' },
    });
    return memberships.map((membership) => this.serializeMembership(membership));
  }

  async createUser(id: string, dto: CreateTenantUserDto) {
    await this.ensureTenant(id);

    if (dto.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: userSelect });
      if (!user) throw new NotFoundException('Account not found');
      if (user.role === UserRole.admin) throw new BadRequestException('Admin accounts do not need tenant assignments');

      return this.prisma.$transaction(async (tx) => {
        const membership = await tx.userTenant.upsert({
          where: { userId_tenantId: { userId: user.id, tenantId: id } },
          create: { userId: user.id, tenantId: id },
          update: {},
          include: { user: { select: userSelect } },
        });
        return this.serializeMembership(membership);
      });
    }

    if (!dto.username || !dto.password || !dto.displayName) {
      throw new BadRequestException('Use userId to assign an existing account, or provide username, password and displayName');
    }
    const existed = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existed) throw new ConflictException('Account username already exists');
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username!,
          passwordHash,
          displayName: dto.displayName!,
          role: UserRole.staff,
          tenantMemberships: { create: { tenantId: id } },
        },
        select: userSelect,
      });
      return { ...user, tenantId: id, assignedAt: user.createdAt };
    });
  }

  async updateUser(tenantId: string, userId: string, dto: UpdateTenantUserDto) {
    await this.ensureMembership(tenantId, userId);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: dto, select: userSelect });
      const assignment = await tx.userTenant.findUniqueOrThrow({ where: { userId_tenantId: { userId, tenantId } } });
      return { ...user, tenantId, assignedAt: assignment.assignedAt };
    });
  }
  async resetUserPassword(
    tenantId: string,
    userId: string,
    dto: ResetTenantUserPasswordDto,
  ) {
    const membership = await this.ensureMembership(tenantId, userId);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    });
    return { tenantId, userId, username: membership.user.username };
  }

  async removeUser(tenantId: string, userId: string) {
    await this.ensureMembership(tenantId, userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.userTenant.delete({ where: { userId_tenantId: { userId, tenantId } } });
    });
    return { tenantId, userId };
  }
  async resetAdminPassword(id: string, password: string) {
    await this.ensureTenant(id);
    const membership = await this.prisma.userTenant.findFirst({
      where: { tenantId: id },
      include: { user: true },
      orderBy: { assignedAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('Tenant account not found');

    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: membership.userId }, data: { passwordHash } });
    });
    return { tenantId: id, accountUserId: membership.userId, username: membership.user.username };
  }

  async remove(id: string) {
    return this.deleteTenantTree([id]);
  }

  async removeMany(dto: BatchTenantDeleteDto) {
    return this.deleteTenantTree(dto.ids);
  }

  private async ensureMembership(tenantId: string, userId: string) {
    await this.ensureTenant(tenantId);
    const membership = await this.prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('Tenant account assignment not found');
    return membership;
  }

  private serializeMembership(membership: {
    assignedAt: Date;
    tenantId: string;
    user: Prisma.UserGetPayload<{ select: typeof userSelect }>;
  }) {
    return {
      ...membership.user,
      tenantId: membership.tenantId,
      assignedAt: membership.assignedAt,
    };
  }

  private async deleteTenantTree(ids: string[]) {
    const tenantIds = [...new Set(ids)];
    return this.prisma.$transaction(async (tx) => {
      const existingTenants = await tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true } });
      if (existingTenants.length !== tenantIds.length) throw new NotFoundException('Some tenants are not found');

      const fittingOrders = await tx.fittingOrder.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const optometryOrders = await tx.optometryOrder.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const customers = await tx.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const importTasks = await tx.importTask.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const memberships = await tx.userTenant.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await tx.user.updateMany({ where: { tenantId: { in: tenantIds } }, data: { tenantId: null } });
      const tenants = await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });

      return {
        deletedCount: tenants.count,
        relatedDeleted: {
          accountAssignments: memberships.count,
          customers: customers.count,
          optometryOrders: optometryOrders.count,
          fittingOrders: fittingOrders.count,
          importTasks: importTasks.count,
        },
      };
    });
  }
}