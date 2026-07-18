import { IsString, IsUUID } from 'class-validator';

export class CreateImportTaskDto {
  @IsString()
  tenantId!: string;

  @IsUUID('4')
  idempotencyKey!: string;
}