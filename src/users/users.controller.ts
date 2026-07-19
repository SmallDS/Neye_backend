import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventLogLevel, UserRole } from '@prisma/client';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LogEvent } from '../event-logs/event-log.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/types/current-user';
import { AssignUserTenantsDto } from './dto/assign-user-tenants.dto';
import { BatchUserStatusDto } from './dto/batch-user-status.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: UserQueryDto) {
    return this.usersService.list(query);
  }

  @Post()
  @LogEvent({ module: 'users', action: 'CREATED', resourceType: 'user' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Post('batch-status')
  @LogEvent({ module: 'users', action: 'BATCH_STATUS_CHANGED', resourceType: 'user', level: EventLogLevel.WARN })
  batchStatus(@CurrentUserContext() user: CurrentUser, @Body() dto: BatchUserStatusDto) {
    return this.usersService.batchStatus(user, dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.usersService.get(id);
  }

  @Patch(':id')
  @LogEvent({ module: 'users', action: 'UPDATED', resourceType: 'user', resourceParam: 'id', level: EventLogLevel.WARN })
  update(@CurrentUserContext() user: CurrentUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user, id, dto);
  }

  @Patch(':id/password')
  @LogEvent({ module: 'users', action: 'PASSWORD_RESET', resourceType: 'user', resourceParam: 'id', level: EventLogLevel.WARN })
  resetPassword(@Param('id') id: string, @Body() dto: ResetUserPasswordDto) {
    return this.usersService.resetPassword(id, dto);
  }

  @Put(':id/tenants')
  @LogEvent({ module: 'users', action: 'TENANTS_ASSIGNED', resourceType: 'user', resourceParam: 'id', level: EventLogLevel.WARN })
  replaceTenants(@Param('id') id: string, @Body() dto: AssignUserTenantsDto) {
    return this.usersService.replaceTenants(id, dto);
  }
}