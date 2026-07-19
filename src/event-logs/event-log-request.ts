import { CurrentUser } from '../common/types/current-user';

export interface EventLogRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  user?: CurrentUser;
  requestId?: string;
  eventLogHandled?: boolean;
}