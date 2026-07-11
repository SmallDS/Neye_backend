import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateTenantUserDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}