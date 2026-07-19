import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EventLogCategory, EventLogLevel, EventLogResult } from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page.dto';

export class EventLogQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(EventLogLevel) level?: EventLogLevel;
  @IsOptional() @IsEnum(EventLogCategory) category?: EventLogCategory;
  @IsOptional() @IsEnum(EventLogResult) result?: EventLogResult;
  @IsOptional() @IsString() @MaxLength(80) module?: string;
  @IsOptional() @IsString() @MaxLength(80) actorUsername?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsString() @MaxLength(128) requestId?: string;
  @IsOptional() @IsString() @MaxLength(160) resourceId?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
}