import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page.dto';

const NOTIFICATION_STATUSES = ['unsubscribed', 'pending', 'retrying', 'sent', 'failed'] as const;

export class FittingOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  notificationStatus?: (typeof NOTIFICATION_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  readyAtFrom?: string;

  @IsOptional()
  @IsDateString()
  readyAtTo?: string;
}