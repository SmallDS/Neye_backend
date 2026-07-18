import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOverviewService } from './admin-overview.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('admin')
export class AdminOverviewController {
  constructor(private readonly adminOverviewService: AdminOverviewService) {}

  @Get('overview')
  overview() {
    return this.adminOverviewService.overview();
  }

  @Get('system-status')
  systemStatus() {
    return this.adminOverviewService.systemStatus();
  }

  @Get('system-summary')
  systemSummary() {
    return this.adminOverviewService.systemStatus();
  }
}