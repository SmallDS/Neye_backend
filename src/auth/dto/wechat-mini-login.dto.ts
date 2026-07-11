import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class WechatMiniLoginDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  scene?: string;
}