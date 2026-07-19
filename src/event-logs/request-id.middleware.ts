import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventLogRequest } from './event-log-request';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: EventLogRequest, response: { setHeader(name: string, value: string): void }, next: () => void) {
    const header = request.headers['x-request-id'];
    const candidate = Array.isArray(header) ? header[0] : header;
    const requestId = typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}