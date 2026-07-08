import { PartialType } from '@nestjs/swagger';
import { CreateOptometryOrderDto } from './create-optometry-order.dto';

export class UpdateOptometryOrderDto extends PartialType(CreateOptometryOrderDto) {}