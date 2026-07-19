import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class ClearEventLogsPreviewDto {
  @IsIn(['all', 'beforeDate'])
  scope: 'all' | 'beforeDate';

  @ValidateIf((value: ClearEventLogsPreviewDto) => value.scope === 'beforeDate')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  beforeDate?: string;
}

export class ClearEventLogsDto extends ClearEventLogsPreviewDto {
  @IsString()
  confirmationText: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedCount: number;
}