import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { EventLogCategory, EventLogLevel, EventLogResult, Gender, ImportTaskPhase, ImportTaskRowStatus, ImportTaskStatus, ImportTaskType, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { toPageResult } from '../common/dto/page.dto';
import { createOrderNo } from '../common/order-number';
import { buildCustomerNameSearchFields } from '../customers/customer-name-search';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogsService } from '../event-logs/event-logs.service';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { ImportTaskQueryDto } from './dto/import-task-query.dto';
import { ImportBatchCanceledError, ImportLeaseLostError, assertImportTaskCanContinue } from './import-batch-atomic';
import { assertImportDimensions, importWorksheetDimensionRef, planImportBatches } from './import-config';
import { createImportErrorCsv } from './import-error-report';
import { normalizeImportFileName } from './import-file-name';
import { IMPORT_CAPABILITIES, ImportUploadFile, validateImportUpload } from './import-file-validation';
import { canRequestImportCancellation, hiddenImportRecord, importPublishWhere } from './import-workflow';

interface ParsedImportRow {
  rowNo: number;
  data: Record<string, string>;
}

interface CustomerProfile {
  name?: string;
  phone?: string;
  gender?: Gender;
  age?: number;
  remark?: string;
  createdAt?: Date;
}

interface ProcessRowResult {
  customerId: string;
  optometryOrderId: string;
}


class ImportRowFailureError extends Error {
  constructor(
    readonly rowId: string,
    readonly rowNo: number,
    readonly importCustomerNo: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

const BASE_COLUMNS: Array<[string, string]> = [
  ['客户导入编号', '必填。相同编号表示同一个客户，多行可导入多张验光单。'],
  ['客户姓名', '非必填。为空时系统默认生成：未命名客户-客户导入编号。'],
  ['手机号', '非必填。仅作为客户信息保存，不作为必填匹配条件。'],
  ['性别', '非必填。可填：未知、男、女。'],
  ['年龄', '非必填。数字。'],
  ['客户备注', '非必填。'],
  ['客户创建时间', '非必填。用于迁移历史客户档案，建议格式：YYYY-MM-DD HH:mm:ss；为空或无法识别时使用导入时间。'],
  ['验光日期', '非必填。为空时默认使用导入当天日期。建议格式：YYYY-MM-DD。'],
];

const GROUPS: Array<[string, string]> = [
  ['远用右眼', 'farRight'],
  ['远用左眼', 'farLeft'],
  ['近用右眼', 'nearRight'],
  ['近用左眼', 'nearLeft'],
];

const PARAMS: Array<[string, string]> = [
  ['球光', 'Sph'],
  ['散光', 'Cyl'],
  ['轴线', 'Axis'],
  ['三棱', 'Prism'],
  ['基底', 'Base'],
  ['加光', 'Add'],
  ['基弧V', 'BcV'],
  ['基弧H', 'BcH'],
  ['直径', 'Dia'],
  ['裸眼视力', 'Ucva'],
  ['矫正视力', 'Bcva'],
];

const EXTRA_COLUMNS: Array<[string, string, string]> = [
  ['远用总瞳距', 'farPd', '非必填。far_pd。'],
  ['远用右眼瞳距', 'farRightPd', '非必填。far_right_pd。'],
  ['远用左眼瞳距', 'farLeftPd', '非必填。far_left_pd。'],
  ['近用瞳距', 'nearPd', '非必填。near_pd。'],
  ['右眼瞳高', 'rightHeight', '非必填。right_height。'],
  ['左眼瞳高', 'leftHeight', '非必填。left_height。'],
  ['验光备注', 'remark', '非必填。'],
];

const TEMPLATE_COLUMNS: Array<[string, string]> = [
  ...BASE_COLUMNS,
  ...GROUPS.flatMap(([label, group]) => PARAMS.map(([paramLabel, suffix]) => [`${label}${paramLabel}`, `非必填。对应 ${group}${suffix}。`] as [string, string])),
  ...EXTRA_COLUMNS.map(([label, , desc]) => [label, desc] as [string, string]),
];

const HEADER_TO_FIELD = new Map<string, string>([
  ...GROUPS.flatMap(([label, group]) => PARAMS.map(([paramLabel, suffix]) => [`${label}${paramLabel}`, `${group}${suffix}`] as [string, string])),
  ...EXTRA_COLUMNS.map(([label, field]) => [label, field] as [string, string]),
]);

const OPTOMETRY_TEXT_FIELDS = new Set([...HEADER_TO_FIELD.values()]);
const TERMINAL_STATUSES = new Set<ImportTaskStatus>([ImportTaskStatus.canceled, ImportTaskStatus.completed, ImportTaskStatus.failed]);

@Injectable()
export class ImportTasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportTasksService.name);
  private readonly workerId = randomUUID();
  private readonly leaseDurationMs = 2 * 60_000;
  private readonly scheduledTaskIds = new Set<string>();
  private workerRunning = false;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogs: EventLogsService,
  ) {}

  async onModuleInit() {
    await this.recoverTasks();
    this.recoveryTimer = setInterval(() => {
      void this.recoverTasks().catch((error: unknown) => {
        this.logger.error(`Import task recovery failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 30_000);
    this.recoveryTimer.unref();
  }

  onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  private async recoverTasks() {
    const now = new Date();
    const resumableTasks = await this.prisma.importTask.findMany({
      where: {
        deletedAt: null,
        phase: { not: ImportTaskPhase.finished },
        OR: [
          { status: { in: [ImportTaskStatus.pending, ImportTaskStatus.canceling] } },
          { status: ImportTaskStatus.running, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    resumableTasks.forEach((task) => this.scheduleTask(task.id));
  }

  private scheduleTask(taskId: string) {
    this.scheduledTaskIds.add(taskId);
    void this.drainTaskQueue();
  }

  private async drainTaskQueue() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (this.scheduledTaskIds.size > 0) {
        const taskId = this.scheduledTaskIds.values().next().value as string;
        this.scheduledTaskIds.delete(taskId);
        try {
          await this.processTask(taskId);
        } catch (error) {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          this.logger.error(`Import task ${taskId} stopped unexpectedly: ${message}`);
        }
      }
    } finally {
      this.workerRunning = false;
      if (this.scheduledTaskIds.size > 0) void this.drainTaskQueue();
    }
  }
  async list(query: ImportTaskQueryDto) {
    const where: Prisma.ImportTaskWhereInput = {
      tenantId: query.tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importTask.findMany({
        where,
        include: { tenant: true, createdBy: { select: { id: true, username: true, displayName: true, role: true, status: true } } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.importTask.count({ where }),
    ]);
    return toPageResult(items, total, query);
  }

  async get(id: string) {
    const task = await this.prisma.importTask.findFirst({
      where: { id, deletedAt: null },
      include: {
        tenant: true,
        createdBy: { select: { id: true, username: true, displayName: true, role: true, status: true } },
        rows: { where: { status: { in: [ImportTaskRowStatus.failed, ImportTaskRowStatus.skipped] } }, orderBy: { rowNo: 'asc' }, take: 500 },
      },
    });
    if (!task) throw new NotFoundException('Import task not found');
    return task;
  }

  async createErrorReport(id: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id, deletedAt: null }, select: { id: true, errorMessage: true } });
    if (!task) throw new NotFoundException('Import task not found');
    const rows = await this.prisma.importTaskRow.findMany({
      where: { taskId: id, status: { in: [ImportTaskRowStatus.failed, ImportTaskRowStatus.skipped] } },
      select: { rowNo: true, importCustomerNo: true, errorMessage: true },
      orderBy: { rowNo: 'asc' },
    });
    return createImportErrorCsv(
      rows.length > 0
        ? rows
        : task.errorMessage
          ? [{ rowNo: 0, importCustomerNo: null, errorMessage: task.errorMessage }]
          : [],
    );
  }
  async createCustomerOptometryTask(user: CurrentUser, dto: CreateImportTaskDto, file: ImportUploadFile | undefined) {
    const existing = await this.findTaskByIdempotencyKey(dto.tenantId, dto.idempotencyKey);
    if (existing) return existing;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    validateImportUpload(file);
    const fileName = normalizeImportFileName(file.originalname);
    const taskId = randomUUID();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    try {
      const task = await this.prisma.$transaction((tx) =>
        tx.importTask.create({
          data: {
            id: taskId,
            tenantId: dto.tenantId,
            idempotencyKey: dto.idempotencyKey,
            createdById: user.id,
            type: ImportTaskType.customer_optometry,
            status: ImportTaskStatus.pending,
            phase: ImportTaskPhase.uploaded,
            fileName,
            source: {
              create: {
                content: file.buffer,
                mimeType: file.mimetype || 'application/octet-stream',
                sizeBytes: file.buffer.length,
                sha256,
              },
            },
          },
          include: {
            tenant: true,
            createdBy: { select: { id: true, username: true, displayName: true, role: true, status: true } },
          },
        }),
      );
      this.scheduleTask(task.id);
      return task;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.findTaskByIdempotencyKey(dto.tenantId, dto.idempotencyKey);
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }
  private findTaskByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.prisma.importTask.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      include: {
        tenant: true,
        createdBy: { select: { id: true, username: true, displayName: true, role: true, status: true } },
      },
    });
  }
  async cancel(id: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Import task not found');
    if (TERMINAL_STATUSES.has(task.status)) return task;
    if (task.phase === ImportTaskPhase.publishing) {
      throw new ConflictException('Import task is publishing and can no longer be canceled');
    }
    if (!canRequestImportCancellation(task.status, task.phase)) return task;

    const canceled = await this.prisma.$transaction(async (tx) => {
      const result = await tx.importTask.updateMany({
        where: {
          id,
          deletedAt: null,
          status: { in: [ImportTaskStatus.pending, ImportTaskStatus.running] },
          phase: { notIn: [ImportTaskPhase.publishing, ImportTaskPhase.finished] },
        },
        data: { status: ImportTaskStatus.canceling, cancelRequestedAt: new Date() },
      });
      if (result.count === 0) {
        const latest = await tx.importTask.findUniqueOrThrow({ where: { id } });
        if (latest.phase === ImportTaskPhase.publishing) {
          throw new ConflictException('Import task is publishing and can no longer be canceled');
        }
        return latest;
      }
      return tx.importTask.findUniqueOrThrow({ where: { id } });
    });
    this.scheduleTask(id);
    return canceled;
  }
  async remove(id: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Import task not found');
    if (task.status === ImportTaskStatus.running || task.status === ImportTaskStatus.canceling || task.phase === ImportTaskPhase.publishing) {
      throw new BadRequestException('Running import task cannot be deleted');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importTask.update({ where: { id }, data: { deletedAt: new Date() } });
      return updated;
    });
  }

  async rollback(id: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Import task not found');
    if (!TERMINAL_STATUSES.has(task.status)) throw new BadRequestException('导入任务未结束，不能回滚');
    if (task.rolledBackAt) throw new BadRequestException('导入任务已回滚');
    if (task.successRows <= 0) throw new BadRequestException('没有可回滚的数据');

    const successRows = await this.prisma.importTaskRow.findMany({
      where: { taskId: id, status: ImportTaskRowStatus.success },
      select: { customerId: true, optometryOrderId: true },
    });
    const customerIds = [...new Set(successRows.map((row) => row.customerId).filter((value): value is string => Boolean(value)))];
    const optometryOrderIds = [...new Set(successRows.map((row) => row.optometryOrderId).filter((value): value is string => Boolean(value)))];
    if (customerIds.length === 0 && optometryOrderIds.length === 0) throw new BadRequestException('没有可回滚的数据');

    const now = new Date();
    const optometryIdSet = new Set(optometryOrderIds);
    const result = await this.prisma.$transaction(async (tx) => {
      const activeCustomerOrders = customerIds.length
        ? await tx.optometryOrder.findMany({
            where: { customerId: { in: customerIds }, deletedAt: null },
            select: { id: true, customerId: true },
          })
        : [];
      const customerHasExternalOrders = new Set(
        activeCustomerOrders.filter((order) => !optometryIdSet.has(order.id)).map((order) => order.customerId),
      );
      const deletableCustomerIds = customerIds.filter((customerId) => !customerHasExternalOrders.has(customerId));

      const deletedFittingOrders = optometryOrderIds.length
        ? await tx.fittingOrder.updateMany({
            where: { optometryOrderId: { in: optometryOrderIds }, deletedAt: null },
            data: { deletedAt: now },
          })
        : { count: 0 };
      const deletedOptometryOrders = optometryOrderIds.length
        ? await tx.optometryOrder.updateMany({
            where: { id: { in: optometryOrderIds }, deletedAt: null },
            data: { deletedAt: now },
          })
        : { count: 0 };
      const deletedCustomers = deletableCustomerIds.length
        ? await tx.customer.updateMany({
            where: { id: { in: deletableCustomerIds }, deletedAt: null },
            data: { deletedAt: now },
          })
        : { count: 0 };

      const updatedTask = await tx.importTask.update({
        where: { id },
        data: {
          rolledBackAt: now,
          rollbackCustomers: deletedCustomers.count,
          rollbackOptometryOrders: deletedOptometryOrders.count,
          rollbackFittingOrders: deletedFittingOrders.count,
        },
        include: {
          tenant: true,
          createdBy: { select: { id: true, username: true, displayName: true, role: true, status: true } },
          rows: { where: { status: { in: [ImportTaskRowStatus.failed, ImportTaskRowStatus.skipped] } }, orderBy: { rowNo: 'asc' }, take: 500 },
        },
      });
      const rollback = {
        customers: deletedCustomers.count,
        optometryOrders: deletedOptometryOrders.count,
        fittingOrders: deletedFittingOrders.count,
      };
      return { task: updatedTask, rollback };
    });

    return { ...result.task, rollback: result.rollback };
  }
  createCustomerOptometryTemplate(): Buffer {
    const workbook = XLSX.utils.book_new();
    const headers = TEMPLATE_COLUMNS.map(([name]) => name);
    const template = XLSX.utils.aoa_to_sheet([headers]);
    const example = XLSX.utils.aoa_to_sheet([
      headers,
      this.rowFromObject({ 客户导入编号: 'C001', 客户姓名: '张三', 手机号: '13800000001', 性别: '男', 年龄: 32, 客户创建时间: '2025-12-20 09:30:00', 验光日期: '2026-01-01', 远用右眼球光: -1.0, 远用左眼球光: -1.25, 远用总瞳距: 62, 验光备注: '第一次验光' }, headers),
      this.rowFromObject({ 客户导入编号: 'C001', 验光日期: '2026-06-01', 远用右眼球光: -1.25, 远用左眼球光: -1.5, 远用总瞳距: 62.5, 验光备注: '同一客户第二张验光单，客户信息可不重复填' }, headers),
      this.rowFromObject({ 客户导入编号: 'C002', 近用右眼加光: 1.5, 近用左眼加光: 1.5, 近用瞳距: 58, 验光备注: '姓名和日期为空，系统使用默认客户名和导入当天日期' }, headers),
    ]);
    const info = XLSX.utils.aoa_to_sheet([
      ['规则', '说明'],
      ['导入范围', '只导入客户与验光单，不导入配镜单、商品字典。'],
      ['权限', '仅 admin 可导入，导入时必须选择租户。'],
      ['必填字段', '只有“客户导入编号”必填。'],
      ['客户合并', '同一次导入中，相同“客户导入编号”归为同一个客户。'],
      ['多张验光单', '同一客户多张验光单写多行，客户导入编号保持一致。'],
      ['客户姓名为空', '系统生成：未命名客户-客户导入编号。'],
      ['客户创建时间', '同一客户多行时取第一次出现的非空值；为空或无法识别时使用实际导入时间。'],
      ['验光日期为空', '系统使用导入当天日期。'],
    ]);
    XLSX.utils.book_append_sheet(workbook, template, '导入模板');
    XLSX.utils.book_append_sheet(workbook, example, '示例数据');
    XLSX.utils.book_append_sheet(workbook, info, '字段说明');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }

  private parseRows(buffer: Buffer): ParsedImportRow[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: false,
        dense: true,
        sheetRows: IMPORT_CAPABILITIES.maxRows + 2,
      });
    } catch {
      throw new BadRequestException('Import file is damaged or is not a readable Excel workbook');
    }
    if (workbook.SheetNames.length > IMPORT_CAPABILITIES.maxSheets) {
      throw new BadRequestException(`Import workbook must not exceed ${IMPORT_CAPABILITIES.maxSheets} worksheets`);
    }
    const sheetName = workbook.SheetNames.includes('导入模板') ? '导入模板' : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new BadRequestException('Template sheet not found');

    const dimensionRef = importWorksheetDimensionRef(sheet);
    if (dimensionRef) {
      const range = XLSX.utils.decode_range(dimensionRef);
      const rowCount = range.e.r - range.s.r + 1;
      const columnCount = range.e.c - range.s.c + 1;
      try { assertImportDimensions(Math.max(0, rowCount - 1), columnCount, IMPORT_CAPABILITIES); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : String(error)); }

    }

    const table = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });
    const headers = (table[0] || []).map((value) => this.text(value));
    if (!headers.includes('客户导入编号')) throw new BadRequestException('Template header 客户导入编号 is required');

    const rows: ParsedImportRow[] = [];
    for (let index = 1; index < table.length; index += 1) {
      const values = table[index] || [];
      const data: Record<string, string> = {};
      headers.forEach((header, columnIndex) => {
        if (header) data[header] = this.text(values[columnIndex]) || '';
      });
      if (Object.values(data).every((value) => !value)) continue;
      rows.push({ rowNo: index + 1, data });
    }
    try { assertImportDimensions(rows.length, headers.length, IMPORT_CAPABILITIES); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : String(error)); }
    return rows;
  }
  private async processTask(taskId: string) {
    const initialTask = await this.prisma.importTask.findFirst({ where: { id: taskId, deletedAt: null } });
    if (!initialTask || initialTask.phase === ImportTaskPhase.finished) return;
    if (initialTask.status === ImportTaskStatus.canceling || initialTask.cancelRequestedAt) {
      await this.finishCanceled(taskId);
      return;
    }

    const now = new Date();
    const claimed = await this.prisma.importTask.updateMany({
      where: {
        id: taskId,
        deletedAt: null,
        phase: { not: ImportTaskPhase.finished },
        OR: [
          { status: ImportTaskStatus.pending },
          { status: ImportTaskStatus.running, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        ],
      },
      data: {
        status: ImportTaskStatus.running,
        startedAt: initialTask.startedAt ?? now,
        finishedAt: null,
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(now.getTime() + this.leaseDurationMs),
        heartbeatAt: now,
      },
    });
    if (claimed.count === 0) return;

    try {
      let task = await this.prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
      if (task.phase === ImportTaskPhase.cleanup) {
        await this.finishFailed(taskId, task.errorMessage || 'Import cleanup resumed after worker interruption');
        return;
      }
      if (task.phase === ImportTaskPhase.uploaded || task.phase === ImportTaskPhase.parsing) {
        await this.stageSource(taskId);
        task = await this.prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
      }
      if (task.phase === ImportTaskPhase.processing) {
        await this.processStagedRows(taskId, task.tenantId);
      }
      await this.publishTask(taskId);
    } catch (error) {
      if (error instanceof ImportBatchCanceledError) {
        await this.finishCanceled(taskId);
        return;
      }
      if (error instanceof ImportLeaseLostError) {
        this.logger.warn(`Import task ${taskId} stopped after lease loss`);
        await this.recordImportEvent(taskId, 'LEASE_LOST', EventLogLevel.WARN, EventLogResult.FAILED, 'Import worker lease was lost');
        return;
      }
      await this.markTaskFailed(taskId, error);
    }
  }

  private async stageSource(taskId: string) {
    const phaseChanged = await this.prisma.importTask.updateMany({
      where: {
        id: taskId,
        status: ImportTaskStatus.running,
        phase: { in: [ImportTaskPhase.uploaded, ImportTaskPhase.parsing] },
        leaseOwner: this.workerId,
        cancelRequestedAt: null,
      },
      data: { phase: ImportTaskPhase.parsing, heartbeatAt: new Date() },
    });
    if (phaseChanged.count === 0) {
      await this.assertActiveLease(this.prisma as unknown as Prisma.TransactionClient, taskId);
    }

    const source = await this.prisma.importTaskSource.findUnique({ where: { taskId } });
    if (!source?.content) {
      const staged = await this.prisma.importTaskRow.count({ where: { taskId } });
      if (staged > 0) {
        await this.prisma.importTask.update({
          where: { id: taskId },
          data: { phase: ImportTaskPhase.processing, stagedRows: staged },
        });
        return;
      }
      throw new BadRequestException('Import source is unavailable');
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    const rows = this.parseRows(Buffer.from(source.content));
    if (rows.length === 0) throw new BadRequestException('Template has no import rows');

    for (const batch of planImportBatches(rows.length, IMPORT_CAPABILITIES.batchSize)) {
      const chunk = rows.slice(batch.from, batch.to);
      await this.prisma.$transaction(async (tx) => {
        await this.assertActiveLease(tx, taskId);
        await tx.importTaskRow.createMany({
          data: chunk.map((row) => ({
            taskId,
            rowNo: row.rowNo,
            importCustomerNo: this.text(row.data['客户导入编号']),
            status: ImportTaskRowStatus.pending,
            rawData: row.data as Prisma.InputJsonObject,
            idempotencyKey: `${taskId}:${row.rowNo}`,
          })),
          skipDuplicates: true,
        });
        const updated = await tx.importTask.updateMany({
          where: { id: taskId, status: ImportTaskStatus.running, leaseOwner: this.workerId, cancelRequestedAt: null },
          data: {
            totalRows: rows.length,
            stagedRows: batch.to,
            lastStagedRowNo: chunk.at(-1)?.rowNo || 0,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + this.leaseDurationMs),
          },
        });
        if (updated.count === 0) throw new ImportLeaseLostError('Import staging lease was lost');
      }, { maxWait: 10_000, timeout: 30_000 });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.assertActiveLease(tx, taskId);
      await tx.importTaskSource.update({
        where: { taskId },
        data: { content: null, purgedAt: new Date() },
      });
      await tx.importTask.update({
        where: { id: taskId },
        data: { phase: ImportTaskPhase.processing, stagedRows: rows.length, totalRows: rows.length },
      });
    });
  }

  private async processStagedRows(taskId: string, tenantId: string) {
    while (true) {
      const pendingRows = await this.prisma.importTaskRow.findMany({
        where: { taskId, status: ImportTaskRowStatus.pending },
        orderBy: { rowNo: 'asc' },
        take: IMPORT_CAPABILITIES.batchSize,
      });
      if (pendingRows.length === 0) return;

      const customerNumbers = [...new Set(pendingRows.map((row) => row.importCustomerNo).filter((value): value is string => Boolean(value)))];
      const priorRows = customerNumbers.length
        ? await this.prisma.importTaskRow.findMany({
            where: { taskId, status: ImportTaskRowStatus.success, importCustomerNo: { in: customerNumbers } },
            select: { importCustomerNo: true, customerId: true },
          })
        : [];
      const customerIds = new Map<string, string>();
      for (const row of priorRows) {
        if (row.importCustomerNo && row.customerId) customerIds.set(row.importCustomerNo, row.customerId);
      }
      const profiles = this.buildCustomerProfiles(
        pendingRows.map((row) => ({ rowNo: row.rowNo, data: (row.rawData || {}) as Record<string, string> })),
      );

      await this.prisma.$transaction(async (tx) => {
        await this.assertActiveLease(tx, taskId);
        const hiddenAt = new Date();
        for (const row of pendingRows) {
          await this.assertActiveLease(tx, taskId);
          const data = (row.rawData || {}) as Record<string, string>;
          const importCustomerNo = row.importCustomerNo || this.text(data['客户导入编号']);
          let result: ProcessRowResult;
          try {
            result = await this.processRow(tx, taskId, tenantId, data, importCustomerNo, profiles, customerIds, hiddenAt);
          } catch (error) {
            throw new ImportRowFailureError(
              row.id,
              row.rowNo,
              importCustomerNo,
              error instanceof Error ? error.message : 'Import row failed',
            );
          }
          await tx.importTaskRow.update({
            where: { id: row.id },
            data: {
              status: ImportTaskRowStatus.success,
              importCustomerNo,
              customerId: result.customerId,
              optometryOrderId: result.optometryOrderId,
              errorMessage: null,
            },
          });
          if (importCustomerNo) customerIds.set(importCustomerNo, result.customerId);
        }
        const processedRows = await tx.importTaskRow.count({ where: { taskId, status: ImportTaskRowStatus.success } });
        const updated = await tx.importTask.updateMany({
          where: { id: taskId, status: ImportTaskStatus.running, phase: ImportTaskPhase.processing, leaseOwner: this.workerId, cancelRequestedAt: null },
          data: {
            processedRows,
            successRows: processedRows,
            failedRows: 0,
            lastProcessedRowNo: pendingRows.at(-1)?.rowNo || 0,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + this.leaseDurationMs),
          },
        });
        if (updated.count === 0) throw new ImportLeaseLostError('Import processing lease was lost');
      }, { maxWait: 10_000, timeout: 60_000 });
    }
  }

  private async publishTask(taskId: string) {
    const current = await this.prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
    if (current.phase === ImportTaskPhase.finished) return;
    if (current.phase !== ImportTaskPhase.publishing) {
      const prepared = await this.prisma.importTask.updateMany({
        where: importPublishWhere(taskId, this.workerId),
        data: { phase: ImportTaskPhase.publishing, heartbeatAt: new Date() },
      });
      if (prepared.count === 0) {
        const latest = await this.prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
        if (latest.cancelRequestedAt || latest.status === ImportTaskStatus.canceling) {
          throw new ImportBatchCanceledError('Import cancellation was requested before publication');
        }
        if (latest.phase !== ImportTaskPhase.publishing) throw new ImportLeaseLostError('Import publication lease was lost');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const publishable = await tx.importTask.findFirst({
        where: {
          id: taskId,
          status: ImportTaskStatus.running,
          phase: ImportTaskPhase.publishing,
          leaseOwner: this.workerId,
          cancelRequestedAt: null,
        },
      });
      if (!publishable) throw new ImportLeaseLostError('Import publication condition was not satisfied');
      const publishedAt = new Date();
      await tx.customer.updateMany({ where: { importTaskId: taskId }, data: { deletedAt: null } });
      await tx.optometryOrder.updateMany({ where: { importTaskId: taskId }, data: { deletedAt: null } });
      await tx.importTask.update({
        where: { id: taskId },
        data: {
          status: ImportTaskStatus.completed,
          phase: ImportTaskPhase.finished,
          processedRows: publishable.stagedRows,
          successRows: publishable.stagedRows,
          failedRows: 0,
          publishedAt,
          finishedAt: publishedAt,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: publishedAt,
        },
      });
    }, { maxWait: 10_000, timeout: 30_000 });
    await this.recordImportEvent(taskId, 'COMPLETED', EventLogLevel.INFO, EventLogResult.SUCCESS);
  }

  private async markTaskFailed(taskId: string, error: unknown) {
    const rowFailure = error instanceof ImportRowFailureError ? error : undefined;
    const message = rowFailure
      ? `Row ${rowFailure.rowNo}: ${rowFailure.message}`
      : error instanceof Error
        ? error.message
        : 'Import task failed';
    const prepared = await this.prisma.importTask.updateMany({
      where: { id: taskId, status: ImportTaskStatus.running, leaseOwner: this.workerId },
      data: { phase: ImportTaskPhase.cleanup, errorMessage: message },
    });
    if (prepared.count === 0) {
      const latest = await this.prisma.importTask.findUnique({ where: { id: taskId } });
      if (latest?.status === ImportTaskStatus.canceling || latest?.cancelRequestedAt) {
        await this.finishCanceled(taskId);
      }
      return;
    }
    await this.finishFailed(taskId, message, rowFailure);
  }

  private async finishFailed(taskId: string, message: string, rowFailure?: ImportRowFailureError) {
    await this.cleanupHiddenImport(taskId, ImportTaskStatus.failed, message, rowFailure);
    await this.recordImportEvent(taskId, 'FAILED', EventLogLevel.ERROR, EventLogResult.FAILED, 'Import processing failed');
  }

  private async assertActiveLease(tx: Prisma.TransactionClient, taskId: string) {
    const task = await tx.importTask.findUnique({
      where: { id: taskId },
      select: { status: true, leaseOwner: true, cancelRequestedAt: true },
    });
    assertImportTaskCanContinue(task, this.workerId);
  }

  private async finishCanceled(taskId: string) {
    await this.prisma.importTask.updateMany({
      where: { id: taskId, phase: { not: ImportTaskPhase.finished } },
      data: { phase: ImportTaskPhase.cleanup },
    });
    await this.cleanupHiddenImport(taskId, ImportTaskStatus.canceled, 'Import task canceled');
    await this.recordImportEvent(taskId, 'CANCELED', EventLogLevel.WARN, EventLogResult.SUCCESS);
  }

  private async cleanupHiddenImport(
    taskId: string,
    terminalStatus: ImportTaskStatus,
    message: string,
    rowFailure?: ImportRowFailureError,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.optometryOrder.deleteMany({ where: { importTaskId: taskId } });
      await tx.customer.deleteMany({ where: { importTaskId: taskId } });
      await tx.importTaskRow.updateMany({
        where: { taskId, status: { in: [ImportTaskRowStatus.pending, ImportTaskRowStatus.success] } },
        data: { status: ImportTaskRowStatus.skipped, customerId: null, optometryOrderId: null, errorMessage: message },
      });
      if (rowFailure) {
        await tx.importTaskRow.updateMany({
          where: { id: rowFailure.rowId, taskId },
          data: {
            status: ImportTaskRowStatus.failed,
            importCustomerNo: rowFailure.importCustomerNo,
            customerId: null,
            optometryOrderId: null,
            errorMessage: rowFailure.message,
          },
        });
      }
      await tx.importTaskSource.updateMany({
        where: { taskId },
        data: { content: null, purgedAt: new Date() },
      });
      const failedRows = await tx.importTaskRow.count({ where: { taskId, status: ImportTaskRowStatus.failed } });
      const totalRows = await tx.importTaskRow.count({ where: { taskId } });
      await tx.importTask.update({
        where: { id: taskId },
        data: {
          status: terminalStatus,
          phase: ImportTaskPhase.finished,
          processedRows: totalRows,
          successRows: 0,
          failedRows,
          finishedAt: new Date(),
          errorMessage: message,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: new Date(),
        },
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  }
  private async recordImportEvent(
    taskId: string,
    action: string,
    level: EventLogLevel,
    result: EventLogResult,
    errorSummary?: string,
  ) {
    try {
      const task = await this.prisma.importTask.findUnique({
        where: { id: taskId },
        select: { tenantId: true, createdById: true, createdBy: { select: { username: true } } },
      });
      await this.eventLogs.recordSafe({
        level,
        category: EventLogCategory.SYSTEM,
        result,
        module: 'import_tasks',
        action,
        actorUserId: task?.createdById,
        actorUsername: task?.createdBy.username,
        tenantId: task?.tenantId,
        resourceType: 'import_task',
        resourceId: taskId,
        errorSummary,
      });
    } catch {
      this.logger.error(`Import event log persistence failed for task ${taskId}`);
    }
  }
  private async processRow(
    tx: Prisma.TransactionClient,
    taskId: string,
    tenantId: string,
    data: Record<string, string>,
    importCustomerNo: string | undefined,
    profiles: Map<string, CustomerProfile>,
    customerIds: Map<string, string>,
    hiddenAt: Date,
  ): Promise<ProcessRowResult> {
    if (!importCustomerNo) throw new BadRequestException('客户导入编号不能为空');
    let customerId = customerIds.get(importCustomerNo);
    const profile = profiles.get(importCustomerNo) || {};

    if (!customerId) {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          ...hiddenImportRecord(taskId, hiddenAt),
          customerNo: createOrderNo('C'),
          name: profile.name || `未命名客户-${importCustomerNo}`,
          ...buildCustomerNameSearchFields(profile.name || `未命名客户-${importCustomerNo}`),
          phone: profile.phone,
          gender: profile.gender || Gender.unknown,
          age: profile.age,
          remark: profile.remark,
          ...(profile.createdAt ? { createdAt: profile.createdAt } : {}),
        },
      });
      customerId = customer.id;
    }

    const order = await tx.optometryOrder.create({
      data: {
        tenantId,
        ...hiddenImportRecord(taskId, hiddenAt),
        customerId,
        orderNo: createOrderNo('O'),
        optometryDate: this.parseDate(data['验光日期']),
        ...this.optometryDataFromRow(data),
      } as Prisma.OptometryOrderUncheckedCreateInput,
    });
    return { customerId, optometryOrderId: order.id };
  }
  private buildCustomerProfiles(rows: ParsedImportRow[]) {
    const profiles = new Map<string, CustomerProfile>();
    for (const row of rows) {
      const importCustomerNo = this.text(row.data['客户导入编号']);
      if (!importCustomerNo) continue;
      const current = profiles.get(importCustomerNo) || {};
      profiles.set(importCustomerNo, {
        name: current.name || this.text(row.data['客户姓名']),
        phone: current.phone || this.text(row.data['手机号']),
        gender: current.gender || this.parseGender(row.data['性别']),
        age: current.age ?? this.parseAge(row.data['年龄']),
        remark: current.remark || this.text(row.data['客户备注']),
        createdAt: current.createdAt ?? this.parseOptionalDateTime(row.data['客户创建时间']),
      });
    }
    return profiles;
  }

  private optometryDataFromRow(data: Record<string, string>): Record<string, string> {
    const result: Record<string, string | undefined> = {};
    for (const [header, field] of HEADER_TO_FIELD.entries()) {
      if (!OPTOMETRY_TEXT_FIELDS.has(field)) continue;
      result[field] = this.text(data[header]);
    }
    return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as Record<string, string>;
  }

  private rowFromObject(row: Record<string, string | number>, headers: string[]) {
    return headers.map((header) => row[header] ?? '');
  }

  private text(value: unknown): string | undefined {
    const text = value === undefined || value === null ? '' : String(value).trim();
    return text || undefined;
  }

  private parseGender(value: unknown): Gender | undefined {
    const text = this.text(value);
    if (!text) return undefined;
    if (text === '男' || text.toLowerCase() === 'male') return Gender.male;
    if (text === '女' || text.toLowerCase() === 'female') return Gender.female;
    return Gender.unknown;
  }

  private parseAge(value: unknown): number | undefined {
    const text = this.normalizeInputText(value);
    if (!text) return undefined;
    const match = text.match(/\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const age = Number(match[0]);
    if (!Number.isInteger(age) || age < 0 || age > 150) return undefined;
    return age;
  }

  private parseOptionalDateTime(value: unknown): Date | undefined {
    const text = this.normalizeInputText(value);
    if (!text) return undefined;

    const compact = text.replace(/\s+/g, '');
    if (/^\d{1,6}(?:\.\d+)?$/.test(compact)) {
      const parsed = XLSX.SSF.parse_date_code(Number(compact));
      if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S));
    }

    const normalized = text
      .replace(/[年月]/g, '-')
      .replace(/日/g, ' ')
      .replace(/[./]/g, '-')
      .trim();
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (match) {
      const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getHours() === hour &&
        date.getMinutes() === minute &&
        date.getSeconds() === second
      ) {
        return date;
      }
      return undefined;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private parseDate(value: unknown): Date {
    const text = this.normalizeInputText(value);
    if (!text) {
      return this.today();
    }

    const compact = text.replace(/\s+/g, '');
    if (/^\d{5}$/.test(compact)) {
      const parsed = XLSX.SSF.parse_date_code(Number(compact));
      if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
    }

    const normalized = compact
      .replace(/[年月]/g, '-')
      .replace(/日/g, '')
      .replace(/[./]/g, '-');
    const ymd = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
    const match = ymd ?? normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(normalized);
    if (Number.isNaN(date.getTime())) return this.today();
    return date;
  }

  private today(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private parseDecimal(value: unknown, label: string): string | undefined {
    const text = this.normalizeInputText(value);
    if (!text || this.isEmptyNumericText(text)) return undefined;
    if (this.isZeroOpticalPowerText(text, label)) return '0';

    const parsed = this.extractNumberishValue(text);
    if (!parsed) throw new BadRequestException(`${label}格式不正确`);

    let number = parsed.number;
    if (this.shouldScaleOpticalPower(label, parsed.token, number)) {
      number /= 100;
    }
    if (!Number.isFinite(number)) throw new BadRequestException(`${label}格式不正确`);
    return this.decimalString(number);
  }

  private parseInteger(value: unknown, label: string): number | undefined {
    const text = this.normalizeInputText(value);
    if (!text || this.isEmptyNumericText(text)) return undefined;
    const parsed = this.extractNumberishValue(text);
    if (!parsed) throw new BadRequestException(`${label}格式不正确`);
    const integer = Math.round(parsed.number);
    if (Math.abs(parsed.number - integer) > 0.000001) throw new BadRequestException(`${label}格式不正确`);
    if (label.includes('轴线') && (integer < 0 || integer > 180)) throw new BadRequestException(`${label}应在 0-180 之间`);
    return integer;
  }

  private normalizeInputText(value: unknown): string | undefined {
    const text = this.text(value);
    if (!text) return undefined;
    const normalized = text
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30))
      .replace(/[＋﹢]/g, '+')
      .replace(/[－﹣−–—]/g, '-')
      .replace(/[．。]/g, '.')
      .replace(/，/g, ',')
      .replace(/\u00a0/g, ' ')
      .trim();
    return normalized || undefined;
  }

  private isEmptyNumericText(text: string) {
    return /^(?:-|--|无|暂无|空|n\/?a|null)$/i.test(text.trim());
  }

  private isZeroOpticalPowerText(text: string, label: string) {
    if (!this.isOpticalPowerLabel(label)) return false;
    return /^(?:平光|平|pl|plano|0度?)$/i.test(text.replace(/\s+/g, ''));
  }

  private isOpticalPowerLabel(label: string) {
    return /球光|散光|三棱|加光/.test(label);
  }

  private extractNumberishValue(text: string): { number: number; token: string } | undefined {
    const candidate = this.stripNumericAffixes(text).replace(/,/g, '.').trim();
    const mixedFraction = candidate.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+(\d+)\/(\d+)$/);
    if (mixedFraction) {
      const whole = Number(this.normalizeNumberToken(mixedFraction[1]));
      const numerator = Number(mixedFraction[2]);
      const denominator = Number(mixedFraction[3]);
      if (!denominator) return undefined;
      return { number: whole + Math.sign(whole || 1) * (numerator / denominator), token: mixedFraction[0] };
    }

    const fraction = candidate.match(/^([+-]?\d+)\/(\d+)$/);
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      if (!denominator) return undefined;
      return { number: numerator / denominator, token: fraction[0] };
    }

    const compact = candidate.replace(/\s+/g, '');
    const matches = compact.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g) ?? [];
    if (matches.length !== 1) return undefined;
    const token = this.normalizeNumberToken(matches[0]);
    const number = Number(token);
    return Number.isFinite(number) ? { number, token } : undefined;
  }

  private stripNumericAffixes(text: string) {
    return text.replace(/(?:ADD|AXIS|AX|PD|SPH|CYL|DS|DC|MM|毫米|度|°|D)/gi, ' ');
  }

  private normalizeNumberToken(token: string) {
    return token
      .replace(/^\+\./, '+0.')
      .replace(/^-\./, '-0.')
      .replace(/^\./, '0.');
  }

  private shouldScaleOpticalPower(label: string, token: string, number: number) {
    if (!this.isOpticalPowerLabel(label)) return false;
    const absoluteToken = token.replace(/^[+-]/, '');
    if (absoluteToken.includes('.') || absoluteToken.includes('/')) return false;
    const absoluteValue = Math.abs(number);
    return absoluteValue >= 20 && absoluteValue <= 3000;
  }

  private decimalString(value: number) {
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
  }
}