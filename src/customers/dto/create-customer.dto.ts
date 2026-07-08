import { Gender } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender: Gender = Gender.unknown;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}