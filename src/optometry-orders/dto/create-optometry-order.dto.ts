import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateOptometryOrderDto {
  @IsDateString()
  optometryDate!: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional() @IsString() farRightSph?: string;
  @IsOptional() @IsString() farRightCyl?: string;
  @IsOptional() @IsString() farRightAxis?: string;
  @IsOptional() @IsString() farRightPrism?: string;
  @IsOptional() @IsString() farRightBase?: string;
  @IsOptional() @IsString() farRightAdd?: string;
  @IsOptional() @IsString() farRightBcV?: string;
  @IsOptional() @IsString() farRightBcH?: string;
  @IsOptional() @IsString() farRightDia?: string;
  @IsOptional() @IsString() farRightUcva?: string;
  @IsOptional() @IsString() farRightBcva?: string;

  @IsOptional() @IsString() farLeftSph?: string;
  @IsOptional() @IsString() farLeftCyl?: string;
  @IsOptional() @IsString() farLeftAxis?: string;
  @IsOptional() @IsString() farLeftPrism?: string;
  @IsOptional() @IsString() farLeftBase?: string;
  @IsOptional() @IsString() farLeftAdd?: string;
  @IsOptional() @IsString() farLeftBcV?: string;
  @IsOptional() @IsString() farLeftBcH?: string;
  @IsOptional() @IsString() farLeftDia?: string;
  @IsOptional() @IsString() farLeftUcva?: string;
  @IsOptional() @IsString() farLeftBcva?: string;

  @IsOptional() @IsString() nearRightSph?: string;
  @IsOptional() @IsString() nearRightCyl?: string;
  @IsOptional() @IsString() nearRightAxis?: string;
  @IsOptional() @IsString() nearRightPrism?: string;
  @IsOptional() @IsString() nearRightBase?: string;
  @IsOptional() @IsString() nearRightAdd?: string;
  @IsOptional() @IsString() nearRightBcV?: string;
  @IsOptional() @IsString() nearRightBcH?: string;
  @IsOptional() @IsString() nearRightDia?: string;
  @IsOptional() @IsString() nearRightUcva?: string;
  @IsOptional() @IsString() nearRightBcva?: string;

  @IsOptional() @IsString() nearLeftSph?: string;
  @IsOptional() @IsString() nearLeftCyl?: string;
  @IsOptional() @IsString() nearLeftAxis?: string;
  @IsOptional() @IsString() nearLeftPrism?: string;
  @IsOptional() @IsString() nearLeftBase?: string;
  @IsOptional() @IsString() nearLeftAdd?: string;
  @IsOptional() @IsString() nearLeftBcV?: string;
  @IsOptional() @IsString() nearLeftBcH?: string;
  @IsOptional() @IsString() nearLeftDia?: string;
  @IsOptional() @IsString() nearLeftUcva?: string;
  @IsOptional() @IsString() nearLeftBcva?: string;

  @IsOptional() @IsString() farPd?: string;
  @IsOptional() @IsString() farRightPd?: string;
  @IsOptional() @IsString() farLeftPd?: string;
  @IsOptional() @IsString() nearPd?: string;
  @IsOptional() @IsString() rightHeight?: string;
  @IsOptional() @IsString() leftHeight?: string;
}