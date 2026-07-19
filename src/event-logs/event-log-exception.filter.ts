import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { EventLogCategory, EventLogLevel, EventLogResult } from '@prisma/client';
import { EventLogRequest } from './event-log-request';
import { EventLogsService } from './event-logs.service';

@Catch()
export class EventLogExceptionFilter implements ExceptionFilter {
  constructor(private readonly eventLogs: EventLogsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<EventLogRequest>();
    const response = http.getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const denied = status === 401 || status === 403 || status === 429;

    if (!request.eventLogHandled && (denied || status >= 500)) {
      void this.eventLogs.recordSafe({
        level: denied ? EventLogLevel.WARN : EventLogLevel.ERROR,
        category: denied ? EventLogCategory.SECURITY : EventLogCategory.SYSTEM,
        result: denied ? EventLogResult.DENIED : EventLogResult.FAILED,
        module: denied ? 'security' : 'http',
        action: denied ? `HTTP_${status}` : 'UNHANDLED_EXCEPTION',
        actorUserId: request.user?.id,
        actorUsername: request.user?.username,
        tenantId: request.user?.tenantId,
        requestId: request.requestId,
        ipAddress: request.ip ?? request.socket?.remoteAddress,
        errorSummary: denied ? this.exceptionMessage(exception, status) : 'Unhandled internal server error',
      });
    }

    const original = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = typeof original === 'object' && original !== null
      ? { ...(original as Record<string, unknown>), requestId: request.requestId }
      : {
          statusCode: status,
          message: typeof original === 'string' ? original : 'Internal server error',
          requestId: request.requestId,
        };
    response.status(status).json(body);
  }

  private exceptionMessage(exception: unknown, status: number) {
    return exception instanceof Error ? exception.message : `HTTP ${status}`;
  }
}