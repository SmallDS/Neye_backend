import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateOptometryStyleDto } from './dto/update-optometry-style.dto';
import { SystemSettingsService } from './system-settings.service';

@ApiTags('system-settings')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get('optometry-style')
  @Roles(UserRole.admin, UserRole.staff)
  getOptometryStyle() {
    return this.systemSettingsService.getOptometryStyle();
  }

  @Patch('optometry-style')
  @Roles(UserRole.admin)
  updateOptometryStyle(@Body() dto: UpdateOptometryStyleDto) {
    return this.systemSettingsService.updateOptometryStyle(dto.value);
  }
}