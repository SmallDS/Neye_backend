import { IsString, MinLength } from 'class-validator';

export class CreateTenantUserDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  displayName!: string;
}