import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CreateProductItemDto } from './dto/create-product-item.dto';
import { ProductItemQueryDto } from './dto/product-item-query.dto';
import { UpdateProductItemDto } from './dto/update-product-item.dto';
import { ProductItemsService } from './product-items.service';

@ApiTags('product-items')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard)
@Controller('product-items')
export class ProductItemsController {
  constructor(private readonly productItemsService: ProductItemsService) {}

  @Get()
  list(@Query() query: ProductItemQueryDto) {
    return this.productItemsService.list(query);
  }

  @Post()
  create(@Body() dto: CreateProductItemDto) {
    return this.productItemsService.create(dto);
  }

  @Post('batch-delete')
  removeMany(@Body() dto: BatchDeleteDto) {
    return this.productItemsService.removeMany(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductItemDto) {
    return this.productItemsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productItemsService.remove(id);
  }
}