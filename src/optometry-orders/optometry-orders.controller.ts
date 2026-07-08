import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser } from '../common/types/current-user';
import { CreateOptometryOrderDto } from './dto/create-optometry-order.dto';
import { OptometryOrderQueryDto } from './dto/optometry-order-query.dto';
import { UpdateOptometryOrderDto } from './dto/update-optometry-order.dto';
import { OptometryOrdersService } from './optometry-orders.service';

@ApiTags('optometry-orders')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard)
@Controller()
export class OptometryOrdersController {
  constructor(private readonly optometryOrdersService: OptometryOrdersService) {}

  @Get('optometry-orders')
  list(@CurrentUserContext() user: CurrentUser, @Query() query: OptometryOrderQueryDto) {
    return this.optometryOrdersService.list(user, query);
  }

  @Post('customers/:customerId/optometry-orders')
  createForCustomer(
    @CurrentUserContext() user: CurrentUser,
    @Param('customerId') customerId: string,
    @Body() dto: CreateOptometryOrderDto,
  ) {
    return this.optometryOrdersService.createForCustomer(user, customerId, dto);
  }

  @Post('optometry-orders/batch-delete')
  removeMany(@CurrentUserContext() user: CurrentUser, @Body() dto: BatchDeleteDto) {
    return this.optometryOrdersService.removeMany(user, dto);
  }

  @Get('optometry-orders/:id')
  get(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.optometryOrdersService.get(user, id);
  }

  @Patch('optometry-orders/:id')
  update(@CurrentUserContext() user: CurrentUser, @Param('id') id: string, @Body() dto: UpdateOptometryOrderDto) {
    return this.optometryOrdersService.update(user, id, dto);
  }

  @Delete('optometry-orders/:id')
  remove(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.optometryOrdersService.remove(user, id);
  }
}