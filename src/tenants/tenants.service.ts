import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { createOrderNo } from '../common/order-number';
import { toPageResult } from '../common/dto/page.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { ResetTenantUserPasswordDto } from './dto/reset-tenant-user-password.dto';
import { TenantQueryDto } from './dto/tenant-query.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly userSelect = {
    id: true,
    tenantId: true,
    username: true,
    displayName: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  };

  private initialAccount(dto: CreateTenantDto): CreateTenantUserDto | undefined {
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
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async list(query: TenantQueryDto) {
    const where = {
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
    const [users, customersCount, optometryOrdersCount, fittingOrdersCount, recentCustomers, recentOptometryOrders, recentFittingOrders] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where: { tenantId: id }, select: this.userSelect, orderBy: { createdAt: 'desc' } }),
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
      if (existed) {
        throw new ConflictException('Account username already exists');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          code: createOrderNo('T'),
          name: dto.name,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
        },
      });

      const user = account
        ? await tx.user.create({
            data: {
              tenantId: tenant.id,
              username: account.username,
              passwordHash: await bcrypt.hash(account.password, 10),
              displayName: account.displayName,
              role: UserRole.staff,
            },
            select: this.userSelect,
          })
        : undefined;

      return { tenantId: tenant.id, tenantCode: tenant.code, accountUserId: user?.id };
    });
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.ensureTenant(id);
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async listUsers(id: string) {
    await this.ensureTenant(id);
    return this.prisma.user.findMany({
      where: { tenantId: id },
      select: this.userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUser(id: string, dto: CreateTenantUserDto) {
    await this.ensureTenant(id);
    const existed = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existed) {
      throw new ConflictException('Account username already exists');
    }
    return this.prisma.user.create({
      data: {
        tenantId: id,
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        displayName: dto.displayName,
        role: UserRole.staff,
      },
      select: this.userSelect,
    });
  }

  async updateUser(tenantId: string, userId: string, dto: UpdateTenantUserDto) {
    await this.ensureTenant(tenantId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) {
      throw new NotFoundException('Tenant account not found');
    }
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: this.userSelect });
  }

  async resetUserPassword(tenantId: string, userId: string, dto: ResetTenantUserPasswordDto) {
    await this.ensureTenant(tenantId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) {
      throw new NotFoundException('Tenant account not found');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.password, 10) },
    });
    return { tenantId, userId, username: user.username };
  }

  async resetAdminPassword(id: string, password: string) {
    await this.ensureTenant(id);
    const user = await this.prisma.user.findFirst({
      where: { tenantId: id },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) {
      throw new NotFoundException('Tenant account not found');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
    return { tenantId: id, accountUserId: user.id, username: user.username };
  }

  async remove(id: string) {
    return this.deleteTenantTree([id]);
  }

  async removeMany(dto: BatchDeleteDto) {
    return this.deleteTenantTree(dto.ids);
  }

  private async deleteTenantTree(ids: string[]) {
    const tenantIds = [...new Set(ids)];
    return this.prisma.$transaction(async (tx) => {
      const existingTenants = await tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true } });
      if (existingTenants.length !== tenantIds.length) {
        throw new NotFoundException('Some tenants are not found');
      }

      const fittingOrders = await tx.fittingOrder.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const optometryOrders = await tx.optometryOrder.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const customers = await tx.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const importTasks = await tx.importTask.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const users = await tx.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
      const tenants = await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });

      return {
        deletedCount: tenants.count,
        relatedDeleted: {
          users: users.count,
          customers: customers.count,
          optometryOrders: optometryOrders.count,
          fittingOrders: fittingOrders.count,
          importTasks: importTasks.count,
        },
      };
    });
  }
}