import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateTenantUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}