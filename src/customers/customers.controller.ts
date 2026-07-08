import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  create(@CurrentUserContext() user: CurrentUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user, dto);
  }

  @Post('batch-delete')
  removeMany(@CurrentUserContext() user: CurrentUser, @Body() dto: BatchDeleteDto) {
    return this.customersService.removeMany(user, dto);
  }

  @Get(':id')
  get(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.customersService.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUserContext() user: CurrentUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.customersService.remove(user, id);
  }
}