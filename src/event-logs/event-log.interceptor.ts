import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EventLogCategory, EventLogLevel, EventLogResult } from '@prisma/client';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { EVENT_LOG_KEY, EventLogOptions } from './event-log.decorator';
import { EventLogRequest } from './event-log-request';
import { EventLogsService } from './event-logs.service';

const SENSITIVE_FIELDS = /(password|secret|token|authorization|cookie|openid|scene|touser|session|raw)/i;

@Injectable()
export class EventLogInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly eventLogs: EventLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<EventLogOptions>(EVENT_LOG_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return next.handle();
    const request = context.switchToHttp().getRequest<EventLogRequest>();

    return next.handle().pipe(
      tap((response) => {
        request.eventLogHandled = true;
        void this.eventLogs.recordSafe(this.buildInput(request, options, response, EventLogResult.SUCCESS));
      }),
      catchError((error: unknown) => {
        request.eventLogHandled = true;
        const status = this.statusOf(error);
        const denied = status === 401 || status === 403 || status === 429;
        const serverError = status >= 500;
        void this.eventLogs.recordSafe({
          ...this.buildInput(request, options, undefined, denied ? EventLogResult.DENIED : EventLogResult.FAILED),
          level: denied ? EventLogLevel.WARN : serverError ? EventLogLevel.ERROR : options.level ?? EventLogLevel.WARN,
          category: denied ? EventLogCategory.SECURITY : serverError ? EventLogCategory.SYSTEM : options.category ?? EventLogCategory.AUDIT,
          errorSummary: this.safeMessage(error, status),
        });
        return throwError(() => error);
      }),
    );
  }

  private buildInput(request: EventLogRequest, options: EventLogOptions, response: unknown, result: EventLogResult) {
    const body = request.body ?? {};
    const responseRecord = response && typeof response === 'object' ? response as Record<string, unknown> : undefined;
    const responseUser = responseRecord?.user && typeof responseRecord.user === 'object'
      ? responseRecord.user as Record<string, unknown>
      : undefined;
    const nestedResource = responseRecord?.task && typeof responseRecord.task === 'object'
      ? responseRecord.task as Record<string, unknown>
      : undefined;
    const resourceId = options.resourceParam
      ? request.params?.[options.resourceParam]
      : options.resourceBodyField && typeof body[options.resourceBodyField] === 'string'
        ? String(body[options.resourceBodyField])
        : typeof responseRecord?.id === 'string'
          ? responseRecord.id
          : typeof nestedResource?.id === 'string'
            ? nestedResource.id
            : undefined;
    const actorUserId = request.user?.id ?? (typeof responseUser?.id === 'string' ? responseUser.id : undefined);
    const actorUsername = request.user?.username
      ?? (typeof responseUser?.username === 'string' ? responseUser.username : undefined)
      ?? (options.action === 'LOGIN' && typeof body.username === 'string' ? body.username : undefined);
    return {
      level: options.level ?? EventLogLevel.INFO,
      category: options.category ?? EventLogCategory.AUDIT,
      result,
      module: options.module,
      action: options.action,
      actorUserId,
      actorUsername,
      tenantId: request.user?.tenantId,
      resourceType: options.resourceType,
      resourceId,
      requestId: request.requestId,
      ipAddress: request.ip ?? request.socket?.remoteAddress,
      metadata: { changedFields: Object.keys(body).filter((key) => !SENSITIVE_FIELDS.test(key)).sort() },
    };
  }

  private statusOf(error: unknown) {
    if (error && typeof error === 'object' && 'getStatus' in error && typeof error.getStatus === 'function') {
      return Number(error.getStatus());
    }
    return 500;
  }

  private safeMessage(error: unknown, status: number) {
    if (status >= 500) return 'Unhandled internal server error';
    return error instanceof Error ? error.message : `HTTP ${status}`;
  }
}