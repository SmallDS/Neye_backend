import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ description: 'Backward-compatible liveness status' })
  check() {
    return this.livenessPayload();
  }

  @Get('live')
  @ApiOkResponse({ description: 'Process liveness status' })
  live() {
    return this.livenessPayload();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Database-backed readiness status' })
  @ApiServiceUnavailableResponse({ description: 'Database is unavailable' })
  async ready() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        service: 'neye-api',
        checks: { database: 'ok' },
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'neye-api',
        checks: { database: 'unavailable' },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private livenessPayload() {
    return {
      status: 'ok',
      service: 'neye-api',
      timestamp: new Date().toISOString(),
    };
  }
}
