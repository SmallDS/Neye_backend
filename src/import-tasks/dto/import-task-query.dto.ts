import { ImportTaskStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page.dto';

export class ImportTaskQueryDto extends PageQueryDto {
  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsEnum(ImportTaskStatus)
  status?: ImportTaskStatus;
}