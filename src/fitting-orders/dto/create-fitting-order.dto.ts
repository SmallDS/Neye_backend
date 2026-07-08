import { IsOptional, IsString } from 'class-validator';

export class CreateFittingOrderDto {
  @IsOptional() @IsString() frameProductItemId?: string;
  @IsOptional() @IsString() frameInfo?: string;
  @IsOptional() @IsString() framePrice?: string;

  @IsOptional() @IsString() lensProductItemId?: string;
  @IsOptional() @IsString() lensInfo?: string;
  @IsOptional() @IsString() lensPrice?: string;

  @IsOptional() @IsString() otherProductItemId?: string;
  @IsOptional() @IsString() otherInfo?: string;
  @IsOptional() @IsString() otherPrice?: string;

  @IsOptional() @IsString() remark?: string;
}