import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventLogLevel, UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { LogEvent } from '../event-logs/event-log.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateOptometryStyleDto } from './dto/update-optometry-style.dto';
import { UpdateWechatAuthDto } from './dto/update-wechat-auth.dto';
import { SystemSettingsService } from './system-settings.service';

@ApiTags('system-settings')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}


  @Get('wechat-auth')
  @Roles(UserRole.admin)
  getWechatAuth() {
    return this.systemSettingsService.getWechatAuth();
  }

  @Patch('wechat-auth')
  @Roles(UserRole.admin)
  @LogEvent({ module: 'system_settings', action: 'WECHAT_AUTH_UPDATED', resourceType: 'system_setting', level: EventLogLevel.WARN })
  updateWechatAuth(@Body() dto: UpdateWechatAuthDto) {
    return this.systemSettingsService.updateWechatAuth(dto);
  }
  @Get('optometry-style')
  @Roles(UserRole.admin, UserRole.staff)
  getOptometryStyle() {
    return this.systemSettingsService.getOptometryStyle();
  }

  @Patch('optometry-style')
  @Roles(UserRole.admin)
  @LogEvent({ module: 'system_settings', action: 'OPTOMETRY_STYLE_UPDATED', resourceType: 'system_setting' })
  updateOptometryStyle(@Body() dto: UpdateOptometryStyleDto) {
    return this.systemSettingsService.updateOptometryStyle(dto.value);
  }
}