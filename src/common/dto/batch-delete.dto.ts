import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class BatchDeleteDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  tenantId?: string;
}