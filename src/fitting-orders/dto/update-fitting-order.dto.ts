import { PartialType } from '@nestjs/swagger';
import { CreateFittingOrderDto } from './create-fitting-order.dto';

export class UpdateFittingOrderDto extends PartialType(CreateFittingOrderDto) {}