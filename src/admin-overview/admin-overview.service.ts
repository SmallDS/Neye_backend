import { Injectable, Logger } from '@nestjs/common';
import { ImportTaskStatus, TenantStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminOverviewService {
  private readonly logger = new Logger(AdminOverviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const [
      tenantTotal,
      tenantActive,
      userTotal,
      userActive,
      customerTotal,
      optometryOrderTotal,
      fittingOrderTotal,
      productItemTotal,
      importTotal,
      importPending,
      importRunning,
      importFailed,
      importCompleted,
      importCompletedTotals,
      customersLast30Days,
      optometryOrdersLast30Days,
      fittingOrdersLast30Days,
    ] = await this.prisma.$transaction([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: TenantStatus.active } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.active } }),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.optometryOrder.count({ where: { deletedAt: null } }),
      this.prisma.fittingOrder.count({ where: { deletedAt: null } }),
      this.prisma.productItem.count({ where: { deletedAt: null } }),
      this.prisma.importTask.count({ where: { deletedAt: null } }),
      this.prisma.importTask.count({ where: { status: ImportTaskStatus.pending, deletedAt: null } }),
      this.prisma.importTask.count({ where: { status: ImportTaskStatus.running, deletedAt: null } }),
      this.prisma.importTask.count({ where: { status: ImportTaskStatus.failed, deletedAt: null } }),
      this.prisma.importTask.count({ where: { status: ImportTaskStatus.completed, deletedAt: null } }),
      this.prisma.importTask.aggregate({
        where: { status: ImportTaskStatus.completed, deletedAt: null },
        _sum: { successRows: true, processedRows: true },
      }),
      this.prisma.customer.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
      this.prisma.optometryOrder.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
      this.prisma.fittingOrder.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
    ]);
    const completedProcessedRows = importCompletedTotals._sum.processedRows ?? 0;
    const completedSuccessRows = importCompletedTotals._sum.successRows ?? 0;

    return {
      counts: {
        tenants: { total: tenantTotal, active: tenantActive, disabled: tenantTotal - tenantActive },
        users: { total: userTotal, active: userActive, disabled: userTotal - userActive },
        customers: customerTotal,
        optometryOrders: optometryOrderTotal,
        fittingOrders: fittingOrderTotal,
        productItems: productItemTotal,
      },
      importTasks: {
        total: importTotal,
        pending: importPending,
        running: importRunning,
        failed: importFailed,
        completed: importCompleted,
        successRate: completedProcessedRows > 0 ? completedSuccessRows / completedProcessedRows : 0,
      },
      trends: {
        periodDays: 30,
        customers: customersLast30Days,
        optometryOrders: optometryOrdersLast30Days,
        fittingOrders: fittingOrdersLast30Days,
      },
    };
  }

  async systemStatus() {
    const checkedAt = new Date();
    const checks: Array<{ name: string; status: 'ok' | 'warning' | 'error'; message: string; latencyMs?: number }> = [];
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push({ name: 'database', status: 'ok', message: 'Database connection is healthy', latencyMs: Date.now() - startedAt });
      const now = new Date();
      const staleImports = await this.prisma.importTask.count({
        where: {
          status: ImportTaskStatus.running,
          deletedAt: null,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
      });
      checks.push({
        name: 'import-worker',
        status: staleImports > 0 ? 'warning' : 'ok',
        message: staleImports > 0 ? `${staleImports} import task lease(s) expired and await recovery` : 'No expired import task leases',
      });
    } catch (error) {
      this.logger.error('Admin system status database check failed', error instanceof Error ? error.stack : String(error));
      checks.push({
        name: 'database',
        status: 'error',
        message: 'Database connection failed',
        latencyMs: Date.now() - startedAt,
      });
    }
    const memory = process.memoryUsage();
    const status = checks.some((check) => check.status === 'error')
      ? 'error'
      : checks.some((check) => check.status === 'warning')
        ? 'warning'
        : 'ok';
    return {
      status,
      checkedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
      runtime: { nodeVersion: process.version, platform: process.platform },
      checks,
    };
  }
}