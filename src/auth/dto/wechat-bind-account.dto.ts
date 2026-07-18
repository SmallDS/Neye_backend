import { IsString, MaxLength, MinLength } from 'class-validator';

export class WechatBindAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  bindingToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password!: string;
}
