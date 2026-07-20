import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser } from '../common/types/current-user';
import { RetryPickupNotificationDto } from './dto/retry-pickup-notification.dto';
import { PickupNotificationsService } from './pickup-notifications.service';

@ApiTags('pickup-notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard)
@Controller('fitting-orders')
export class PickupNotificationsController {
  constructor(private readonly pickupNotifications: PickupNotificationsService) {}

  @Get(':id/pickup-subscription-qr')
  getQr(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.pickupNotifications.getQr(user, id);
  }

  @Patch(':id/ready-for-pickup')
  markReady(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.pickupNotifications.markReady(user, id);
  }

  @Post(':id/pickup-notification/retry')
  retry(
    @CurrentUserContext() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: RetryPickupNotificationDto,
  ) {
    return this.pickupNotifications.retryFailed(user, id, dto.reason);
  }

  @Get(':id/pickup-notification/attempts')
  attempts(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.pickupNotifications.attempts(user, id);
  }
}