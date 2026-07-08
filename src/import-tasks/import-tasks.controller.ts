import { Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/types/current-user';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { ImportTaskQueryDto } from './dto/import-task-query.dto';
import { ImportTasksService } from './import-tasks.service';

@ApiTags('import-tasks')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('import-tasks')
export class ImportTasksController {
  constructor(private readonly importTasksService: ImportTasksService) {}

  @Get('template/customer-optometry')
  downloadCustomerOptometryTemplate(@Res() response: any) {
    const buffer = this.importTasksService.createCustomerOptometryTemplate();
    const fileName = encodeURIComponent('客户验光单导入模板.xlsx');
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    response.send(buffer);
  }

  @Get()
  list(@Query() query: ImportTaskQueryDto) {
    return this.importTasksService.list(query);
  }

  @Post('customer-optometry')
  @UseInterceptors(FileInterceptor('file'))
  createCustomerOptometryTask(
    @CurrentUserContext() user: CurrentUser,
    @Body() dto: CreateImportTaskDto,
    @UploadedFile() file: any,
  ) {
    return this.importTasksService.createCustomerOptometryTask(user, dto, file);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.importTasksService.get(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.importTasksService.cancel(id);
  }

  @Post(':id/rollback')
  rollback(@Param('id') id: string) {
    return this.importTasksService.rollback(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.importTasksService.remove(id);
  }
}