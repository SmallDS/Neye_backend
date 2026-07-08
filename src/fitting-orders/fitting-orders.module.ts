import { Module } from '@nestjs/common';
import { FittingOrdersController } from './fitting-orders.controller';
import { FittingOrdersService } from './fitting-orders.service';

@Module({
  controllers: [FittingOrdersController],
  providers: [FittingOrdersService],
})
export class FittingOrdersModule {}