import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class WechatSessionDecisionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  confirmationToken!: string;

  @IsIn(['confirm', 'reject'])
  decision!: 'confirm' | 'reject';
}
