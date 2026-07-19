import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventLogLevel, UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { LogEvent } from '../event-logs/event-log.decorator';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CreateProductItemDto } from './dto/create-product-item.dto';
import { ProductItemQueryDto } from './dto/product-item-query.dto';
import { UpdateProductItemDto } from './dto/update-product-item.dto';
import { ProductItemsService } from './product-items.service';

@ApiTags('product-items')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Controller('product-items')
export class ProductItemsController {
  constructor(private readonly productItemsService: ProductItemsService) {}

  @Get()
  list(@Query() query: ProductItemQueryDto) {
    return this.productItemsService.list(query);
  }

  @Post()
  @Roles(UserRole.admin)
  @LogEvent({ module: 'product_items', action: 'CREATED', resourceType: 'product_item' })
  create(@Body() dto: CreateProductItemDto) {
    return this.productItemsService.create(dto);
  }

  @Post('batch-delete')
  @Roles(UserRole.admin)
  @LogEvent({ module: 'product_items', action: 'BATCH_DELETED', resourceType: 'product_item', level: EventLogLevel.WARN })
  removeMany(@Body() dto: BatchDeleteDto) {
    return this.productItemsService.removeMany(dto);
  }

  @Patch(':id')
  @Roles(UserRole.admin)
  @LogEvent({ module: 'product_items', action: 'UPDATED', resourceType: 'product_item', resourceParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateProductItemDto) {
    return this.productItemsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.admin)
  @LogEvent({ module: 'product_items', action: 'DELETED', resourceType: 'product_item', resourceParam: 'id', level: EventLogLevel.WARN })
  remove(@Param('id') id: string) {
    return this.productItemsService.remove(id);
  }
}