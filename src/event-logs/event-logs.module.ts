import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { EventLogExceptionFilter } from './event-log-exception.filter';
import { EventLogInterceptor } from './event-log.interceptor';
import { EventLogsController } from './event-logs.controller';
import { EventLogsService } from './event-logs.service';
import { RequestIdMiddleware } from './request-id.middleware';

@Global()
@Module({
  controllers: [EventLogsController],
  providers: [
    EventLogsService,
    RequestIdMiddleware,
    { provide: APP_INTERCEPTOR, useClass: EventLogInterceptor },
    { provide: APP_FILTER, useClass: EventLogExceptionFilter },
  ],
  exports: [EventLogsService, RequestIdMiddleware],
})
export class EventLogsModule {}