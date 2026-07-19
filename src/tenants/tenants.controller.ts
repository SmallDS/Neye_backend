import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventLogLevel, UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { LogEvent } from '../event-logs/event-log.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { BatchTenantDeleteDto } from './dto/dangerous-tenant-operation.dto';
import { ResetTenantAdminPasswordDto } from './dto/reset-tenant-admin-password.dto';
import { ResetTenantUserPasswordDto } from './dto/reset-tenant-user-password.dto';
import { TenantQueryDto } from './dto/tenant-query.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  list(@Query() query: TenantQueryDto) {
    return this.tenantsService.list(query);
  }

  @Post()
  @LogEvent({ module: 'tenants', action: 'CREATED', resourceType: 'tenant' })
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Post('batch-delete')
  @LogEvent({ module: 'tenants', action: 'BATCH_DELETED', resourceType: 'tenant', level: EventLogLevel.WARN })
  removeMany(@Body() dto: BatchTenantDeleteDto) {
    return this.tenantsService.removeMany(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tenantsService.get(id);
  }

  @Patch(':id')
  @LogEvent({ module: 'tenants', action: 'UPDATED', resourceType: 'tenant', resourceParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  @LogEvent({ module: 'tenants', action: 'DELETED', resourceType: 'tenant', resourceParam: 'id', level: EventLogLevel.WARN })
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }

  @Get(':id/users')
  listUsers(@Param('id') id: string) {
    return this.tenantsService.listUsers(id);
  }

  @Post(':id/users')
  @LogEvent({ module: 'tenants', action: 'MEMBER_CREATED', resourceType: 'tenant', resourceParam: 'id' })
  createUser(@Param('id') id: string, @Body() dto: CreateTenantUserDto) {
    return this.tenantsService.createUser(id, dto);
  }

  @Delete(':id/users/:userId')
  @LogEvent({ module: 'tenants', action: 'MEMBER_REMOVED', resourceType: 'tenant', resourceParam: 'id', level: EventLogLevel.WARN })
  removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.tenantsService.removeUser(id, userId);
  }

  @Patch(':id/users/:userId')
  @LogEvent({ module: 'tenants', action: 'MEMBER_UPDATED', resourceType: 'tenant', resourceParam: 'id', level: EventLogLevel.WARN })
  updateUser(@Param('id') id: string, @Param('userId') userId: string, @Body() dto: UpdateTenantUserDto) {
    return this.tenantsService.updateUser(id, userId, dto);
  }

  @Patch(':id/users/:userId/password')
  @LogEvent({ module: 'tenants', action: 'MEMBER_PASSWORD_RESET', resourceType: 'tenant', resourceParam: 'id', level: EventLogLevel.WARN })
  resetUserPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: ResetTenantUserPasswordDto,
  ) {
    return this.tenantsService.resetUserPassword(id, userId, dto);
  }

  @Patch(':id/admin-password')
  @LogEvent({ module: 'tenants', action: 'ADMIN_PASSWORD_RESET', resourceType: 'tenant', resourceParam: 'id', level: EventLogLevel.WARN })
  resetAdminPassword(@Param('id') id: string, @Body() dto: ResetTenantAdminPasswordDto) {
    return this.tenantsService.resetAdminPassword(id, dto.password);
  }
}