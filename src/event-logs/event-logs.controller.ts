import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/types/current-user';
import { ClearEventLogsDto, ClearEventLogsPreviewDto } from './dto/clear-event-logs.dto';
import { EventLogQueryDto } from './dto/event-log-query.dto';
import { UpdateRetentionDto } from './dto/update-retention.dto';
import { EventLogsService } from './event-logs.service';

@ApiTags('admin-event-logs')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('admin/event-logs')
export class EventLogsController {
  constructor(private readonly eventLogs: EventLogsService) {}

  @Get()
  list(@Query() query: EventLogQueryDto) { return this.eventLogs.list(query); }

  @Get('retention')
  retention() { return this.eventLogs.getRetention(); }

  @Patch('retention')
  updateRetention(@CurrentUserContext() user: CurrentUser, @Body() dto: UpdateRetentionDto) {
    return this.eventLogs.updateRetention(dto.retentionDays, user);
  }

  @Post('clear-preview')
  previewClear(@Body() dto: ClearEventLogsPreviewDto) { return this.eventLogs.previewClear(dto); }

  @Post('clear')
  clear(@CurrentUserContext() user: CurrentUser, @Body() dto: ClearEventLogsDto) {
    return this.eventLogs.clear(dto, user);
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.eventLogs.get(id); }
}