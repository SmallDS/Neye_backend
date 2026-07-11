import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
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
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Post('batch-delete')
  removeMany(@Body() dto: BatchDeleteDto) {
    return this.tenantsService.removeMany(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tenantsService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }

  @Get(':id/users')
  listUsers(@Param('id') id: string) {
    return this.tenantsService.listUsers(id);
  }

  @Post(':id/users')
  createUser(@Param('id') id: string, @Body() dto: CreateTenantUserDto) {
    return this.tenantsService.createUser(id, dto);
  }

  @Delete(':id/users/:userId')
  removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.tenantsService.removeUser(id, userId);
  }

  @Patch(':id/users/:userId')
  updateUser(@Param('id') id: string, @Param('userId') userId: string, @Body() dto: UpdateTenantUserDto) {
    return this.tenantsService.updateUser(id, userId, dto);
  }

  @Patch(':id/users/:userId/password')
  resetUserPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: ResetTenantUserPasswordDto,
  ) {
    return this.tenantsService.resetUserPassword(id, userId, dto);
  }

  @Patch(':id/admin-password')
  resetAdminPassword(@Param('id') id: string, @Body() dto: ResetTenantAdminPasswordDto) {
    return this.tenantsService.resetAdminPassword(id, dto.password);
  }
}