import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductItemCategory } from '@prisma/client';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { toPageResult } from '../common/dto/page.dto';
import { createOrderNo } from '../common/order-number';
import { tenantFilter } from '../common/tenant-scope';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { PickupNotificationsService } from '../pickup-notifications/pickup-notifications.service';
import { CreateFittingOrderDto } from './dto/create-fitting-order.dto';
import { FittingOrderQueryDto } from './dto/fitting-order-query.dto';
import { UpdateFittingOrderDto } from './dto/update-fitting-order.dto';

interface ResolvedProductSnapshot {
  productItemId?: string;
  info?: string;
  price: Prisma.Decimal;
}

@Injectable()
export class FittingOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickupNotifications: PickupNotificationsService,
  ) {}

  private decimal(value?: string | Prisma.Decimal | null): Prisma.Decimal {
    if (value instanceof Prisma.Decimal) return value;
    const text = value?.trim();
    return new Prisma.Decimal(text ? text : '0');
  }

  private text(value?: string | null): string | undefined {
    const text = value?.trim();
    return text || undefined;
  }

  private async resolveProductSnapshot(
    tx: Prisma.TransactionClient,
    category: ProductItemCategory,
    productItemId: string | undefined,
    info: string | undefined,
    price: string | Prisma.Decimal | undefined,
  ): Promise<ResolvedProductSnapshot> {
    const normalizedInfo = this.text(info);

    if (productItemId) {
      const item = await tx.productItem.findFirst({ where: { id: productItemId, category, deletedAt: null } });
      if (!item) throw new BadRequestException(`Invalid ${category} product item`);
      await tx.productItem.update({ where: { id: item.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
      return {
        productItemId: item.id,
        info: normalizedInfo ?? item.name,
        price: price === undefined ? item.defaultPrice : this.decimal(price),
      };
    }

    if (!normalizedInfo) {
      return { info: normalizedInfo, price: this.decimal(price) };
    }

    const existing = await tx.productItem.findFirst({
      where: { category, name: normalizedInfo, deletedAt: null },
      orderBy: [{ usageCount: 'desc' }, { lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (existing) {
      await tx.productItem.update({ where: { id: existing.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
      return {
        productItemId: existing.id,
        info: normalizedInfo,
        price: price === undefined ? existing.defaultPrice : this.decimal(price),
      };
    }

    const created = await tx.productItem.create({
      data: {
        category,
        name: normalizedInfo,
        defaultPrice: this.decimal(price),
        usageCount: 1,
        lastUsedAt: new Date(),
      },
    });

    return { productItemId: created.id, info: normalizedInfo, price: created.defaultPrice };
  }

  async list(user: CurrentUser, query: FittingOrderQueryDto) {
    const where: Prisma.FittingOrderWhereInput = {
      ...tenantFilter(user, query.tenantId),
      deletedAt: null,
      ...(query.keyword
        ? {
            OR: [
              { orderNo: { contains: query.keyword } },
              { customer: { name: { contains: query.keyword } } },
              { customer: { phone: { contains: query.keyword } } },
              { frameInfo: { contains: query.keyword } },
              { lensInfo: { contains: query.keyword } },
              { otherInfo: { contains: query.keyword } },
            ],
          }
        : {}),
      ...(query.readyAtFrom || query.readyAtTo
        ? { readyForPickupAt: { ...(query.readyAtFrom ? { gte: new Date(query.readyAtFrom) } : {}), ...(query.readyAtTo ? { lte: new Date(query.readyAtTo) } : {}) } }
        : {}),
      ...this.notificationWhere(query.notificationStatus),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fittingOrder.findMany({
        where,
        include: { customer: true, optometryOrder: true, pickupScene: true, pickupSubscription: true, pickupNotificationTask: true },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fittingOrder.count({ where }),
    ]);
    const settingState = await this.pickupNotifications.getSettingState();
    return toPageResult(items.map((item) => this.pickupNotifications.toSafeOrder(item, settingState)), total, query);
  }

  async createForOptometryOrder(user: CurrentUser, optometryOrderId: string, dto: CreateFittingOrderDto) {
    const optometryOrder = await this.prisma.optometryOrder.findFirst({
      where: { id: optometryOrderId, ...tenantFilter(user), deletedAt: null },
    });
    if (!optometryOrder) throw new NotFoundException('Optometry order not found');
    const tenantId = optometryOrder.tenantId;

    return this.prisma.$transaction(async (tx) => {
      const frame = await this.resolveProductSnapshot(tx, ProductItemCategory.frame, dto.frameProductItemId, dto.frameInfo, dto.framePrice);
      const lens = await this.resolveProductSnapshot(tx, ProductItemCategory.lens, dto.lensProductItemId, dto.lensInfo, dto.lensPrice);
      const other = await this.resolveProductSnapshot(tx, ProductItemCategory.other, dto.otherProductItemId, dto.otherInfo, dto.otherPrice);

      return tx.fittingOrder.create({
        data: {
          tenantId,
          customerId: optometryOrder.customerId,
          optometryOrderId,
          orderNo: createOrderNo('F'),
          frameProductItemId: frame.productItemId,
          frameInfo: frame.info,
          framePrice: frame.price,
          lensProductItemId: lens.productItemId,
          lensInfo: lens.info,
          lensPrice: lens.price,
          otherProductItemId: other.productItemId,
          otherInfo: other.info,
          otherPrice: other.price,
          totalAmount: frame.price.plus(lens.price).plus(other.price),
          remark: dto.remark,
        },
      });
    });
  }

  async get(user: CurrentUser, id: string) {
    const order = await this.prisma.fittingOrder.findFirst({
      where: { id, ...tenantFilter(user), deletedAt: null },
      include: { customer: true, optometryOrder: true, frameProductItem: true, lensProductItem: true, otherProductItem: true, pickupScene: true, pickupSubscription: true, pickupNotificationTask: true },
    });
    if (!order) throw new NotFoundException('Fitting order not found');
    const settingState = await this.pickupNotifications.getSettingState();
    return this.pickupNotifications.toSafeOrder(order, settingState);
  }

  async update(user: CurrentUser, id: string, dto: UpdateFittingOrderDto) {
    const existing = await this.get(user, id);

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.FittingOrderUncheckedUpdateInput = { ...dto };
      let framePrice = dto.framePrice === undefined ? existing.framePrice : this.decimal(dto.framePrice);
      let lensPrice = dto.lensPrice === undefined ? existing.lensPrice : this.decimal(dto.lensPrice);
      let otherPrice = dto.otherPrice === undefined ? existing.otherPrice : this.decimal(dto.otherPrice);

      if (dto.frameProductItemId !== undefined || dto.frameInfo !== undefined) {
        const frame = await this.resolveProductSnapshot(tx, ProductItemCategory.frame, dto.frameProductItemId, dto.frameInfo ?? existing.frameInfo ?? undefined, dto.framePrice ?? existing.framePrice);
        data.frameProductItemId = frame.productItemId;
        data.frameInfo = frame.info;
        if (dto.frameProductItemId !== undefined && dto.framePrice === undefined) framePrice = frame.price;
      }
      if (dto.lensProductItemId !== undefined || dto.lensInfo !== undefined) {
        const lens = await this.resolveProductSnapshot(tx, ProductItemCategory.lens, dto.lensProductItemId, dto.lensInfo ?? existing.lensInfo ?? undefined, dto.lensPrice ?? existing.lensPrice);
        data.lensProductItemId = lens.productItemId;
        data.lensInfo = lens.info;
        if (dto.lensProductItemId !== undefined && dto.lensPrice === undefined) lensPrice = lens.price;
      }
      if (dto.otherProductItemId !== undefined || dto.otherInfo !== undefined) {
        const other = await this.resolveProductSnapshot(tx, ProductItemCategory.other, dto.otherProductItemId, dto.otherInfo ?? existing.otherInfo ?? undefined, dto.otherPrice ?? existing.otherPrice);
        data.otherProductItemId = other.productItemId;
        data.otherInfo = other.info;
        if (dto.otherProductItemId !== undefined && dto.otherPrice === undefined) otherPrice = other.price;
      }

      data.framePrice = dto.framePrice === undefined && data.framePrice === undefined ? undefined : framePrice;
      data.lensPrice = dto.lensPrice === undefined && data.lensPrice === undefined ? undefined : lensPrice;
      data.otherPrice = dto.otherPrice === undefined && data.otherPrice === undefined ? undefined : otherPrice;
      data.totalAmount = framePrice.plus(lensPrice).plus(otherPrice);

      return tx.fittingOrder.update({ where: { id }, data });
    });
  }

  async remove(user: CurrentUser, id: string) {
    await this.get(user, id);
    return this.prisma.fittingOrder.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private notificationWhere(status?: FittingOrderQueryDto['notificationStatus']): Prisma.FittingOrderWhereInput {
    if (status === 'unsubscribed') return { pickupSubscription: { is: null } };
    if (status === 'retrying') return { pickupNotificationTask: { is: { status: 'retrying' } } };
    if (status === 'sent') return { pickupNotificationTask: { is: { status: 'sent' } } };
    if (status === 'failed') return { pickupNotificationTask: { is: { status: 'failed' } } };
    if (status === 'pending') {
      return {
        pickupSubscription: { isNot: null },
        OR: [
          { pickupNotificationTask: { is: null } },
          { pickupNotificationTask: { is: { status: { in: ['pending', 'processing'] } } } },
        ],
      };
    }
    return {};
  }
  async removeMany(user: CurrentUser, dto: BatchDeleteDto) {
    const ids = [...new Set(dto.ids)];
    const orders = await this.prisma.fittingOrder.findMany({
      where: { id: { in: ids }, ...tenantFilter(user, dto.tenantId), deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (orders.length !== ids.length) {
      throw new BadRequestException('Some fitting orders are not found or not accessible');
    }

    const orderIds = orders.map((item) => item.id);
    const tenantIds = [...new Set(orders.map((item) => item.tenantId))];
    const deleted = await this.prisma.fittingOrder.updateMany({
      where: { id: { in: orderIds }, tenantId: { in: tenantIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { deletedCount: deleted.count };
  }
}