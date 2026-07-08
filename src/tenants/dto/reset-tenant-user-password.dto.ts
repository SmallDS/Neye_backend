import { IsString, MinLength } from 'class-validator';

export class ResetTenantUserPasswordDto {
  @IsString()
  @MinLength(6)
  password!: string;
}