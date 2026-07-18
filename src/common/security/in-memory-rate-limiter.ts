import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class InMemoryRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private operations = 0;

  consume(bucket: string, key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const normalizedKey = key.trim().toLowerCase() || 'unknown';
    const entryKey = `${bucket}:${normalizedKey}`;
    const current = this.entries.get(entryKey);

    if (!current || current.resetAt <= now) {
      this.entries.set(entryKey, { count: 1, resetAt: now + windowMs });
      this.cleanupExpiredEntries(now);
      return;
    }

    if (current.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many authentication attempts. Please try again later.',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.count += 1;
    this.cleanupExpiredEntries(now);
  }

  private cleanupExpiredEntries(now: number) {
    this.operations += 1;
    if (this.operations % 100 !== 0) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}
