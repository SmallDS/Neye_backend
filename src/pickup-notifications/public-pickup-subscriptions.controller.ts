import { Body, Controller, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { InMemoryRateLimiter } from '../common/security/in-memory-rate-limiter';
import { PickupSceneDto, SubscribePickupNotificationDto } from './dto/public-pickup-subscription.dto';
import { PickupNotificationsService } from './pickup-notifications.service';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function pickupPublicRateLimitKey(ip: string, scene: string) {
  const sceneDigest = createHash('sha256').update(scene).digest('hex');
  return `${ip || 'unknown'}:${sceneDigest}`;
}

@ApiTags('public-pickup-subscriptions')
@Controller('public/pickup-subscriptions')
export class PublicPickupSubscriptionsController {
  constructor(
    private readonly pickupNotifications: PickupNotificationsService,
    private readonly rateLimiter: InMemoryRateLimiter,
  ) {}

  @Post('context')
  context(@Body() dto: PickupSceneDto, @Ip() ip: string) {
    this.rateLimiter.consume(
      'pickup-subscription-context',
      pickupPublicRateLimitKey(ip, dto.scene),
      60,
      FIVE_MINUTES_MS,
    );
    return this.pickupNotifications.getPublicContext(dto);
  }

  @Post('subscribe')
  subscribe(@Body() dto: SubscribePickupNotificationDto, @Ip() ip: string) {
    this.rateLimiter.consume(
      'pickup-subscription-submit',
      pickupPublicRateLimitKey(ip, dto.scene),
      10,
      FIVE_MINUTES_MS,
    );
    return this.pickupNotifications.subscribe(dto);
  }
}