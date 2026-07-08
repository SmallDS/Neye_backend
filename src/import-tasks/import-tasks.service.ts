import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, ImportTaskRowStatus, ImportTaskStatus, ImportTaskType, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { toPageResult } from '../common/dto/page.dto';
import { createOrderNo } from '../common/order-number';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { ImportTaskQueryDto } from './dto/import-task-query.dto';

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
}

interface ProcessRowResult {
  customerId: string;
  optometryOrderId: string;
}

const BASE_COLUMNS: Array<[string, string]> = [
  ['客户导入编号', '必填。相同编号表示同一个客户，多行可导入多张验光单。'],
  ['客户姓名', '非必填。为空时系统默认生成：未命名客户-客户导入编号。'],
  ['手机号', '非必填。仅作为客户信息保存，不作为必填匹配条件。'],
  ['性别', '非必填。可填：未知、男、女。'],
  ['年龄', '非必填。数字。'],
  ['客户备注', '非必填。'],
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
export class ImportTasksService {
  constructor(private readonly prisma: PrismaService) {}

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

  async createCustomerOptometryTask(user: CurrentUser, dto: CreateImportTaskDto, file: { buffer?: Buffer; originalname?: string } | undefined) {
    if (!file?.buffer) throw new BadRequestException('Import file is required');
    const fileName = file.originalname || '客户验光单导入.xlsx';
    if (!/\.xlsx?$/i.test(fileName)) throw new BadRequestException('Only xlsx/xls files are supported');

    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const rows = this.parseRows(file.buffer);
    if (rows.length === 0) throw new BadRequestException('Template has no import rows');

    const task = await this.prisma.importTask.create({
      data: {
        tenantId: dto.tenantId,
        createdById: user.id,
        type: ImportTaskType.customer_optometry,
        status: ImportTaskStatus.pending,
        fileName,
        totalRows: rows.length,
        rows: {
          createMany: {
            data: rows.map((row) => ({
              rowNo: row.rowNo,
              importCustomerNo: this.text(row.data['客户导入编号']),
              status: ImportTaskRowStatus.pending,
              rawData: row.data as Prisma.InputJsonObject,
            })),
          },
        },
      },
      include: { tenant: true, createdBy: { select: { id: true, username: true, displayName: true, role: true, status: true } } },
    });

    setImmediate(() => void this.processTask(task.id));
    return task;
  }

  async cancel(id: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Import task not found');
    if (TERMINAL_STATUSES.has(task.status)) return task;
    return this.prisma.importTask.update({
      where: { id },
      data: { status: ImportTaskStatus.canceling, cancelRequestedAt: new Date() },
    });
  }

  async remove(id: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Import task not found');
    if (task.status === ImportTaskStatus.running || task.status === ImportTaskStatus.canceling) {
      throw new BadRequestException('Running import task cannot be deleted');
    }
    return this.prisma.importTask.update({ where: { id }, data: { deletedAt: new Date() } });
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
      return {
        task: updatedTask,
        rollback: {
          customers: deletedCustomers.count,
          optometryOrders: deletedOptometryOrders.count,
          fittingOrders: deletedFittingOrders.count,
        },
      };
    });

    return { ...result.task, rollback: result.rollback };
  }
  createCustomerOptometryTemplate(): Buffer {
    const workbook = XLSX.utils.book_new();
    const headers = TEMPLATE_COLUMNS.map(([name]) => name);
    const template = XLSX.utils.aoa_to_sheet([headers]);
    const example = XLSX.utils.aoa_to_sheet([
      headers,
      this.rowFromObject({ 客户导入编号: 'C001', 客户姓名: '张三', 手机号: '13800000001', 性别: '男', 年龄: 32, 验光日期: '2026-01-01', 远用右眼球光: -1.0, 远用左眼球光: -1.25, 远用总瞳距: 62, 验光备注: '第一次验光' }, headers),
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
      ['验光日期为空', '系统使用导入当天日期。'],
    ]);
    XLSX.utils.book_append_sheet(workbook, template, '导入模板');
    XLSX.utils.book_append_sheet(workbook, example, '示例数据');
    XLSX.utils.book_append_sheet(workbook, info, '字段说明');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }

  private parseRows(buffer: Buffer): ParsedImportRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = workbook.SheetNames.includes('导入模板') ? '导入模板' : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new BadRequestException('Template sheet not found');

    const table = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
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
    return rows;
  }

  private async processTask(taskId: string) {
    const task = await this.prisma.importTask.findFirst({ where: { id: taskId, deletedAt: null } });
    if (!task) return;
    if (task.status === ImportTaskStatus.canceling) {
      await this.finishCanceled(taskId);
      return;
    }
    if (task.status !== ImportTaskStatus.pending) return;

    await this.prisma.importTask.update({ where: { id: taskId }, data: { status: ImportTaskStatus.running, startedAt: new Date() } });
    const rows = await this.prisma.importTaskRow.findMany({ where: { taskId, status: ImportTaskRowStatus.pending }, orderBy: { rowNo: 'asc' } });
    const profiles = this.buildCustomerProfiles(rows.map((row) => ({ rowNo: row.rowNo, data: row.rawData as Record<string, string> })));
    const customerIds = new Map<string, string>();
    let processedRows = 0;
    let successRows = 0;
    let failedRows = 0;

    try {
      for (const row of rows) {
        const currentTask = await this.prisma.importTask.findUnique({ where: { id: taskId }, select: { status: true, cancelRequestedAt: true } });
        if (!currentTask || currentTask.status === ImportTaskStatus.canceling || currentTask.cancelRequestedAt) {
          await this.finishCanceled(taskId);
          return;
        }

        const data = (row.rawData || {}) as Record<string, string>;
        const importCustomerNo = this.text(data['客户导入编号']);
        try {
          const result = await this.processRow(task.tenantId, data, importCustomerNo, profiles, customerIds);
          processedRows += 1;
          successRows += 1;
          await this.prisma.$transaction([
            this.prisma.importTaskRow.update({
              where: { id: row.id },
              data: { status: ImportTaskRowStatus.success, importCustomerNo, customerId: result.customerId, optometryOrderId: result.optometryOrderId },
            }),
            this.prisma.importTask.update({ where: { id: taskId }, data: { processedRows, successRows, failedRows } }),
          ]);
        } catch (error) {
          processedRows += 1;
          failedRows += 1;
          await this.prisma.$transaction([
            this.prisma.importTaskRow.update({
              where: { id: row.id },
              data: { status: ImportTaskRowStatus.failed, importCustomerNo, errorMessage: error instanceof Error ? error.message : '导入失败' },
            }),
            this.prisma.importTask.update({ where: { id: taskId }, data: { processedRows, successRows, failedRows } }),
          ]);
        }
      }
      await this.prisma.importTask.update({ where: { id: taskId }, data: { status: ImportTaskStatus.completed, finishedAt: new Date(), processedRows, successRows, failedRows } });
    } catch (error) {
      await this.prisma.importTask.update({
        where: { id: taskId },
        data: { status: ImportTaskStatus.failed, finishedAt: new Date(), errorMessage: error instanceof Error ? error.message : '导入任务失败' },
      });
    }
  }

  private async finishCanceled(taskId: string) {
    const skipped = await this.prisma.importTaskRow.updateMany({
      where: { taskId, status: ImportTaskRowStatus.pending },
      data: { status: ImportTaskRowStatus.skipped, errorMessage: '任务已取消' },
    });
    const counters = await this.prisma.importTaskRow.groupBy({ by: ['status'], where: { taskId }, _count: { _all: true } });
    const countByStatus = new Map(counters.map((item) => [item.status, item._count._all]));
    await this.prisma.importTask.update({
      where: { id: taskId },
      data: {
        status: ImportTaskStatus.canceled,
        finishedAt: new Date(),
        processedRows: (countByStatus.get(ImportTaskRowStatus.success) || 0) + (countByStatus.get(ImportTaskRowStatus.failed) || 0) + skipped.count,
        successRows: countByStatus.get(ImportTaskRowStatus.success) || 0,
        failedRows: countByStatus.get(ImportTaskRowStatus.failed) || 0,
      },
    });
  }

  private async processRow(
    tenantId: string,
    data: Record<string, string>,
    importCustomerNo: string | undefined,
    profiles: Map<string, CustomerProfile>,
    customerIds: Map<string, string>,
  ): Promise<ProcessRowResult> {
    if (!importCustomerNo) throw new BadRequestException('客户导入编号不能为空');
    const cachedCustomerId = customerIds.get(importCustomerNo);
    const profile = profiles.get(importCustomerNo) || {};

    const result = await this.prisma.$transaction(async (tx) => {
      let customerId = cachedCustomerId;
      if (!customerId) {
        const customer = await tx.customer.create({
          data: {
            tenantId,
            customerNo: createOrderNo('C'),
            name: profile.name || `未命名客户-${importCustomerNo}`,
            phone: profile.phone,
            gender: profile.gender || Gender.unknown,
            age: profile.age,
            remark: profile.remark,
          },
        });
        customerId = customer.id;
      }

      const order = await tx.optometryOrder.create({
        data: {
          tenantId,
          customerId,
          orderNo: createOrderNo('O'),
          optometryDate: this.parseDate(data['验光日期']),
          ...this.optometryDataFromRow(data),
        } as Prisma.OptometryOrderUncheckedCreateInput,
      });
      return { customerId, optometryOrderId: order.id };
    });

    customerIds.set(importCustomerNo, result.customerId);
    return result;
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