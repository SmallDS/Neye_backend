import { ProductItemCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page.dto';

export class ProductItemQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(ProductItemCategory)
  category?: ProductItemCategory;

  @IsOptional()
  @IsString()
  keyword?: string;
}