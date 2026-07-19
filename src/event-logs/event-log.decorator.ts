import { SetMetadata } from '@nestjs/common';
import { EventLogCategory, EventLogLevel } from '@prisma/client';

export const EVENT_LOG_KEY = 'event-log';

export interface EventLogOptions {
  module: string;
  action: string;
  resourceType?: string;
  resourceParam?: string;
  resourceBodyField?: string;
  level?: EventLogLevel;
  category?: EventLogCategory;
}

export const LogEvent = (options: EventLogOptions) => SetMetadata(EVENT_LOG_KEY, options);