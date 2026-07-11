import { IsString, MinLength } from 'class-validator';

export class WechatBindAccountDto {
  @IsString()
  bindingToken!: string;

  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}