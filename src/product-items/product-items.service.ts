import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { toPageResult } from '../common/dto/page.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductItemDto } from './dto/create-product-item.dto';
import { ProductItemQueryDto } from './dto/product-item-query.dto';
import { UpdateProductItemDto } from './dto/update-product-item.dto';

@Injectable()
export class ProductItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ProductItemQueryDto) {
    const where: Prisma.ProductItemWhereInput = {
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.keyword ? { name: { contains: query.keyword } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productItem.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ usageCount: 'desc' }, { lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.productItem.count({ where }),
    ]);
    return toPageResult(items, total, query);
  }

  async create(dto: CreateProductItemDto) {
    return this.prisma.productItem.create({
      data: {
        category: dto.category,
        name: dto.name,
        defaultPrice: dto.defaultPrice ?? '0',
        remark: dto.remark,
      },
    });
  }

  async get(id: string) {
    const item = await this.prisma.productItem.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Product item not found');
    return item;
  }

  async update(id: string, dto: UpdateProductItemDto) {
    await this.get(id);
    return this.prisma.productItem.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.get(id);
    return this.prisma.productItem.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async removeMany(dto: BatchDeleteDto) {
    const ids = [...new Set(dto.ids)];
    const items = await this.prisma.productItem.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    if (items.length !== ids.length) {
      throw new NotFoundException('Some product items are not found');
    }

    const deleted = await this.prisma.productItem.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { deletedCount: deleted.count };
  }
}