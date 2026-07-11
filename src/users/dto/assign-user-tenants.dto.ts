import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class AssignUserTenantsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tenantIds!: string[];
}