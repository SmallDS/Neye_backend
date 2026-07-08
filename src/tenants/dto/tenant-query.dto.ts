import { TenantStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page.dto';

export class TenantQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}