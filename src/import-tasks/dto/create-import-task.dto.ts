import { IsString } from 'class-validator';

export class CreateImportTaskDto {
  @IsString()
  tenantId!: string;
}