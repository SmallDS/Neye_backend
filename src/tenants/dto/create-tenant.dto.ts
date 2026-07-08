import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  accountUsername?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  accountPassword?: string;

  @IsOptional()
  @IsString()
  accountDisplayName?: string;

  /** @deprecated Use accountUsername. */
  @IsOptional()
  @IsString()
  adminUsername?: string;

  /** @deprecated Use accountPassword. */
  @IsOptional()
  @IsString()
  @MinLength(6)
  adminPassword?: string;

  /** @deprecated Use accountDisplayName. */
  @IsOptional()
  @IsString()
  adminDisplayName?: string;
}