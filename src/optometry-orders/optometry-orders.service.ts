import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { toPageResult } from '../common/dto/page.dto';
import { createOrderNo } from '../common/order-number';
import { tenantFilter } from '../common/tenant-scope';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOptometryOrderDto } from './dto/create-optometry-order.dto';
import { OptometryOrderQueryDto } from './dto/optometry-order-query.dto';
import { UpdateOptometryOrderDto } from './dto/update-optometry-order.dto';

@Injectable()
export class OptometryOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private dataFromDto(dto: CreateOptometryOrderDto | UpdateOptometryOrderDto): Prisma.OptometryOrderUncheckedUpdateInput {
    return { ...dto, optometryDate: dto.optometryDate ? new Date(dto.optometryDate) : undefined };
  }

  async list(user: CurrentUser, query: OptometryOrderQueryDto) {
    const where: Prisma.OptometryOrderWhereInput = {
      ...tenantFilter(user, query.tenantId),
      deletedAt: null,
      ...(query.keyword
        ? {
            OR: [
              { orderNo: { contains: query.keyword } },
              { customer: { name: { contains: query.keyword } } },
              { customer: { phone: { contains: query.keyword } } },
            ],
          }
        : {}),
      ...(query.optometryDateFrom || query.optometryDateTo
        ? {
            optometryDate: {
              ...(query.optometryDateFrom ? { gte: new Date(query.optometryDateFrom) } : {}),
              ...(query.optometryDateTo ? { lte: new Date(query.optometryDateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.optometryOrder.findMany({
        where,
        include: { customer: true },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { optometryDate: 'desc' },
      }),
      this.prisma.optometryOrder.count({ where }),
    ]);
    return toPageResult(items, total, query);
  }

  async createForCustomer(user: CurrentUser, customerId: string, dto: CreateOptometryOrderDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, ...tenantFilter(user), deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.optometryOrder.create({
      data: {
        ...(this.dataFromDto(dto) as Prisma.OptometryOrderUncheckedCreateInput),
        tenantId: customer.tenantId,
        customerId,
        orderNo: createOrderNo('O'),
        optometryDate: new Date(dto.optometryDate),
      },
    });
  }

  async get(user: CurrentUser, id: string) {
    const order = await this.prisma.optometryOrder.findFirst({
      where: { id, ...tenantFilter(user), deletedAt: null },
      include: { customer: true, fittingOrders: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } } },
    });
    if (!order) throw new NotFoundException('Optometry order not found');
    return order;
  }

  async update(user: CurrentUser, id: string, dto: UpdateOptometryOrderDto) {
    await this.get(user, id);
    return this.prisma.optometryOrder.update({ where: { id }, data: this.dataFromDto(dto) });
  }

  async remove(user: CurrentUser, id: string) {
    const order = await this.get(user, id);
    const relatedCount = await this.prisma.fittingOrder.count({
      where: { optometryOrderId: id, tenantId: order.tenantId, deletedAt: null },
    });
    if (relatedCount > 0) throw new BadRequestException('Optometry order has fitting orders');
    return this.prisma.optometryOrder.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async removeMany(user: CurrentUser, dto: BatchDeleteDto) {
    const ids = [...new Set(dto.ids)];
    const orders = await this.prisma.optometryOrder.findMany({
      where: { id: { in: ids }, ...tenantFilter(user, dto.tenantId), deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (orders.length !== ids.length) {
      throw new BadRequestException('Some optometry orders are not found or not accessible');
    }

    const orderIds = orders.map((item) => item.id);
    const tenantIds = [...new Set(orders.map((item) => item.tenantId))];
    const deletedAt = new Date();
    const [fittingOrders, optometryOrders] = await this.prisma.$transaction([
      this.prisma.fittingOrder.updateMany({
        where: { optometryOrderId: { in: orderIds }, tenantId: { in: tenantIds }, deletedAt: null },
        data: { deletedAt },
      }),
      this.prisma.optometryOrder.updateMany({
        where: { id: { in: orderIds }, tenantId: { in: tenantIds }, deletedAt: null },
        data: { deletedAt },
      }),
    ]);

    return { deletedCount: optometryOrders.count, relatedDeleted: { fittingOrders: fittingOrders.count } };
  }
}