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
import { IMPORT_CAPABILITIES, MAX_IMPORT_FILE_BYTES } from './import-file-validation';
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
    const fileName = encodeURIComponent('\u5ba2\u6237\u9a8c\u5149\u5355\u5bfc\u5165\u6a21\u677f.xlsx');
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="customer-optometry-import-template.xlsx"; filename*=UTF-8''${fileName}`);
    response.send(buffer);
  }

  @Get('capabilities')
  capabilities() {
    return IMPORT_CAPABILITIES;
  }

  @Get()
  list(@Query() query: ImportTaskQueryDto) {
    return this.importTasksService.list(query);
  }

  @Post('customer-optometry')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 } }))
  createCustomerOptometryTask(
    @CurrentUserContext() user: CurrentUser,
    @Body() dto: CreateImportTaskDto,
    @UploadedFile() file: any,
  ) {
    return this.importTasksService.createCustomerOptometryTask(user, dto, file);
  }

  @Get(':id/error-report')
  async errorReport(@Param('id') id: string, @Res() response: any) {
    const report = await this.importTasksService.createErrorReport(id);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="import-${id}-errors.csv"`);
    response.send(report);
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