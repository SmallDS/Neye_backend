import { Module } from '@nestjs/common';
import { ProductItemsController } from './product-items.controller';
import { ProductItemsService } from './product-items.service';

@Module({
  controllers: [ProductItemsController],
  providers: [ProductItemsService],
  exports: [ProductItemsService],
})
export class ProductItemsModule {}