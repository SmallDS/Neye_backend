import { ClearEventLogsPreviewDto } from './dto/clear-event-logs.dto';

export function shanghaiMidnightToUtc(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('beforeDate must be YYYY-MM-DD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
  const shifted = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  if (shifted.getUTCFullYear() !== year || shifted.getUTCMonth() !== month - 1 || shifted.getUTCDate() !== day) {
    throw new Error('beforeDate is not a valid calendar date');
  }
  return utc;
}

export function eventLogClearConfirmation(dto: ClearEventLogsPreviewDto, count: number) {
  return dto.scope === 'all'
    ? `确认清空全部日志（预计 ${count} 条）`
    : `确认清空 ${dto.beforeDate} 前日志（预计 ${count} 条）`;
}