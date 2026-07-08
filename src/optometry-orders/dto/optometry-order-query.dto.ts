import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page.dto';

export class OptometryOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsDateString()
  optometryDateFrom?: string;

  @IsOptional()
  @IsDateString()
  optometryDateTo?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}