import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class PickupSceneDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32}$/)
  scene: string;
}

export class SubscribePickupNotificationDto extends PickupSceneDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  templateId: string;
}