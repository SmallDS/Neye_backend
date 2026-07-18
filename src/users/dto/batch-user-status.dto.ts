import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsUUID } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class BatchUserStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @IsEnum(UserStatus)
  status!: UserStatus;

}