import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class WechatMiniLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  scene?: string;
}
