import { IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page.dto';

export class CustomerQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}