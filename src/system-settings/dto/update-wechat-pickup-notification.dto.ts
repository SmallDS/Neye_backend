import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { PICKUP_NOTIFICATION_SOURCES, PickupNotificationSource } from '../wechat-pickup-notification';

export class WechatPickupKeywordMappingDto {
  @IsString()
  @Matches(/^(?:thing|character_string|time|date|number)\d+$/)
  keyword: string;

  @IsIn(PICKUP_NOTIFICATION_SOURCES)
  source: PickupNotificationSource;
}

export class UpdateWechatPickupNotificationDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(128)
  templateId: string;

  @IsString()
  @MaxLength(200)
  pickupTip: string;

  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => WechatPickupKeywordMappingDto)
  keywordMapping: WechatPickupKeywordMappingDto[];
}