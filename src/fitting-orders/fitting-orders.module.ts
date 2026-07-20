import { Module } from '@nestjs/common';
import { PickupNotificationsModule } from '../pickup-notifications/pickup-notifications.module';
import { FittingOrdersController } from './fitting-orders.controller';
import { FittingOrdersService } from './fitting-orders.service';

@Module({
  imports: [PickupNotificationsModule],
  controllers: [FittingOrdersController],
  providers: [FittingOrdersService],
})
export class FittingOrdersModule {}