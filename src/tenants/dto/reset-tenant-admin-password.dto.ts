import { IsString, MinLength } from 'class-validator';

export class ResetTenantAdminPasswordDto {
  @IsString()
  @MinLength(6)
  password!: string;
}