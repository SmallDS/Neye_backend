import { Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

@Module({
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService],
})
export class SystemSettingsModule {}