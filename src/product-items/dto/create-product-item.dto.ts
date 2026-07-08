import { ProductItemCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateProductItemDto {
  @IsEnum(ProductItemCategory)
  category!: ProductItemCategory;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  defaultPrice?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}