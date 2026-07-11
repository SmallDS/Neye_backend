import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateWechatAuthDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  appSecret?: string;

  @IsOptional()
  @IsBoolean()
  clearSecret?: boolean;
}
