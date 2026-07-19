import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventLogLevel } from '@prisma/client';
import { LogEvent } from '../event-logs/event-log.decorator';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { BatchDeleteDto } from '../common/dto/batch-delete.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser } from '../common/types/current-user';
import { CreateFittingOrderDto } from './dto/create-fitting-order.dto';
import { FittingOrderQueryDto } from './dto/fitting-order-query.dto';
import { UpdateFittingOrderDto } from './dto/update-fitting-order.dto';
import { FittingOrdersService } from './fitting-orders.service';

@ApiTags('fitting-orders')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantGuard)
@Controller()
export class FittingOrdersController {
  constructor(private readonly fittingOrdersService: FittingOrdersService) {}

  @Get('fitting-orders')
  list(@CurrentUserContext() user: CurrentUser, @Query() query: FittingOrderQueryDto) {
    return this.fittingOrdersService.list(user, query);
  }

  @Post('optometry-orders/:optometryOrderId/fitting-orders')
  @LogEvent({ module: 'fitting_orders', action: 'CREATED', resourceType: 'fitting_order' })
  createForOptometryOrder(
    @CurrentUserContext() user: CurrentUser,
    @Param('optometryOrderId') optometryOrderId: string,
    @Body() dto: CreateFittingOrderDto,
  ) {
    return this.fittingOrdersService.createForOptometryOrder(user, optometryOrderId, dto);
  }

  @Post('fitting-orders/batch-delete')
  @LogEvent({ module: 'fitting_orders', action: 'BATCH_DELETED', resourceType: 'fitting_order', level: EventLogLevel.WARN })
  removeMany(@CurrentUserContext() user: CurrentUser, @Body() dto: BatchDeleteDto) {
    return this.fittingOrdersService.removeMany(user, dto);
  }

  @Get('fitting-orders/:id')
  get(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.fittingOrdersService.get(user, id);
  }

  @Patch('fitting-orders/:id')
  @LogEvent({ module: 'fitting_orders', action: 'UPDATED', resourceType: 'fitting_order', resourceParam: 'id' })
  update(@CurrentUserContext() user: CurrentUser, @Param('id') id: string, @Body() dto: UpdateFittingOrderDto) {
    return this.fittingOrdersService.update(user, id, dto);
  }

  @Delete('fitting-orders/:id')
  @LogEvent({ module: 'fitting_orders', action: 'DELETED', resourceType: 'fitting_order', resourceParam: 'id', level: EventLogLevel.WARN })
  remove(@CurrentUserContext() user: CurrentUser, @Param('id') id: string) {
    return this.fittingOrdersService.remove(user, id);
  }
}