import { Module } from '@nestjs/common';
import { InMemoryRateLimiter } from '../common/security/in-memory-rate-limiter';
import { WechatModule } from '../wechat/wechat.module';
import { PickupNotificationsController } from './pickup-notifications.controller';
import { PickupNotificationsService } from './pickup-notifications.service';
import { PickupNotificationWorker } from './pickup-notification.worker';
import { PublicPickupSubscriptionsController } from './public-pickup-subscriptions.controller';

@Module({
  imports: [WechatModule],
  controllers: [PublicPickupSubscriptionsController, PickupNotificationsController],
  providers: [PickupNotificationsService, PickupNotificationWorker, InMemoryRateLimiter],
  exports: [PickupNotificationsService],
})
export class PickupNotificationsModule {}