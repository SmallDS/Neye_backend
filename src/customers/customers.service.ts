import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { toPageResult } from '../common/dto/page.dto';
import { createOrderNo } from '../common/order-number';
import { tenantFilter, requireTenantId } from '../common/tenant-scope';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUser, query: CustomerQueryDto) {
    const where: Prisma.CustomerWhereInput = {
      ...tenantFilter(user, query.tenantId),
      deletedAt: null,
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword } },
              { phone: { contains: query.keyword } },
              { customerNo: { contains: query.keyword } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return toPageResult(items, total, query);
  }

  async create(user: CurrentUser, dto: CreateCustomerDto) {
    const tenantId = requireTenantId(user, dto.tenantId);
    return this.prisma.customer.create({
      data: {
        tenantId,
        customerNo: createOrderNo('C'),
        name: dto.name,
        phone: dto.phone,
        gender: dto.gender,
        age: dto.age,
        remark: dto.remark,
      },
    });
  }

  async get(user: CurrentUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, ...tenantFilter(user), deletedAt: null },
      include: {
        optometryOrders: {
          where: { deletedAt: null },
          orderBy: { optometryDate: 'desc' },
          take: 20,
        },
        fittingOrders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(user: CurrentUser, id: string, dto: UpdateCustomerDto) {
    await this.get(user, id);
    const { tenantId: _tenantId, ...data } = dto;
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(user: CurrentUser, id: string) {
    const customer = await this.get(user, id);
    const relatedCount = await this.prisma.optometryOrder.count({
      where: { customerId: id, tenantId: customer.tenantId, deletedAt: null },
    });
    if (relatedCount > 0) throw new BadRequestException('Customer has optometry orders');
    return this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async removeMany(user: CurrentUser, dto: BatchDeleteDto) {
    const ids = [...new Set(dto.ids)];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: ids }, ...tenantFilter(user, dto.tenantId), deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (customers.length !== ids.length) {
      throw new BadRequestException('Some customers are not found or not accessible');
    }

    const customerIds = customers.map((item) => item.id);
    const tenantIds = [...new Set(customers.map((item) => item.tenantId))];
    const deletedAt = new Date();
    const [fittingOrders, optometryOrders, deletedCustomers] = await this.prisma.$transaction([
      this.prisma.fittingOrder.updateMany({
        where: { customerId: { in: customerIds }, tenantId: { in: tenantIds }, deletedAt: null },
        data: { deletedAt },
      }),
      this.prisma.optometryOrder.updateMany({
        where: { customerId: { in: customerIds }, tenantId: { in: tenantIds }, deletedAt: null },
        data: { deletedAt },
      }),
      this.prisma.customer.updateMany({
        where: { id: { in: customerIds }, tenantId: { in: tenantIds }, deletedAt: null },
        data: { deletedAt },
      }),
    ]);

    return {
      deletedCount: deletedCustomers.count,
      relatedDeleted: { optometryOrders: optometryOrders.count, fittingOrders: fittingOrders.count },
    };
  }
}