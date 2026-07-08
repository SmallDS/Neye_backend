import { IsObject } from 'class-validator';

export class UpdateOptometryStyleDto {
  @IsObject()
  value!: Record<string, unknown>;
}