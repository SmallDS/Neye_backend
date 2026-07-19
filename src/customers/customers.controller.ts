import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventLogLevel } from '@prisma/client';
import { LogEvent } from '../event-logs/event-log.decorator';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser } from '../common/types/current-user';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@CurrentUserContext() user: CurrentUser, @Query() query: CustomerQueryDto) {
    return this.customersService.list(user, query);
  }

  @Post()
  @LogEvent({ module: 'customers', action: 'CREATED', resourceType: 'customer' })
  create(@CurrentUserContext() user: CurrentUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user, dto);
  }

  @Post('batch-delete')
  @LogEvent({ module: 'customers', action: 'BATCH_DELETED', resourceType: 'customer', level: EventLogLevel.WARN })
  removeMany(@CurrentUserContext() user: CurrentUser, @Body() dto: BatchDeleteDto) {
    return this.customersService.removeMany(user, dto);
  }

  @Get(':id')
  get(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.customersService.get(user, id);
  }

  @Patch(':id')
  @LogEvent({ module: 'customers', action: 'UPDATED', resourceType: 'customer', resourceParam: 'id' })
  update(@CurrentUserContext() user: CurrentUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(user, id, dto);
  }

  @Delete(':id')
  @LogEvent({ module: 'customers', action: 'DELETED', resourceType: 'customer', resourceParam: 'id', level: EventLogLevel.WARN })
  remove(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.customersService.remove(user, id);
  }
}