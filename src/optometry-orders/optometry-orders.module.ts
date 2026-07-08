import { Module } from '@nestjs/common';
import { OptometryOrdersController } from './optometry-orders.controller';
import { OptometryOrdersService } from './optometry-orders.service';

@Module({
  controllers: [OptometryOrdersController],
  providers: [OptometryOrdersService],
})
export class OptometryOrdersModule {}