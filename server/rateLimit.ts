import type { Request, Response, NextFunction } from 'express';
import { logger } from './logging.js';

/**
 * Small in-process sliding-window rate limiter.
 *
 * Suitable for a single-instance deployment; if the API is scaled horizontally,
 * swap the store for Redis (the middleware contract stays the same).
 */
interface Hit {
  timestamps: number[];
}

const buckets = new Map<string, Hit>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, hit] of buckets) {
    hit.timestamps = hit.timestamps.filter((ts) => now - ts < 15 * 60_000);
    if (hit.timestamps.length === 0) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

function clientKey(req: Request, prefix: string): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ||
    req.socket.remoteAddress ||
    'unknown';
  return `${prefix}:${ip}`;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix, message } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);

    const key = options.keyGenerator ? options.keyGenerator(req) : clientKey(req, keyPrefix);
    const hit = buckets.get(key) ?? { timestamps: [] };
    hit.timestamps = hit.timestamps.filter((ts) => now - ts < windowMs);

    if (hit.timestamps.length >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowMs - (now - hit.timestamps[0])) / 1000)
      );
      buckets.set(key, hit);
      logger.warn('security.rate_limited', { key: keyPrefix, path: req.path, method: req.method });
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: message || 'Too many requests. Please slow down and try again shortly.',
        retryAfterSeconds,
      });
      return;
    }

    hit.timestamps.push(now);
    buckets.set(key, hit);
    next();
  };
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}
