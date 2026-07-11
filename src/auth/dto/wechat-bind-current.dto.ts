import { IsString, MinLength } from 'class-validator';

export class WechatBindCurrentDto {
  @IsString()
  @MinLength(1)
  code!: string;
}