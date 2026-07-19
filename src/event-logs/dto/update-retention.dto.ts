import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateRetentionDto {
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(730)
  retentionDays: number;
}