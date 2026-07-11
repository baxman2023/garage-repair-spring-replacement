import { SlidingWindowLimiter } from '@copyforge/core';

/**
 * Per-IP throttle for the credential endpoints (login/register). Sized to slow
 * online guessing without locking out a shared office NAT. In-memory is fine:
 * the app runs as a single PM2 process (spec §2).
 */
const LIMIT = 20;
const WINDOW_MS = 60_000;

let limiter: SlidingWindowLimiter | null = null;

export function allowAuthAttempt(req: Request, bucket: 'login' | 'register'): boolean {
  limiter ??= new SlidingWindowLimiter({ limit: LIMIT, windowMs: WINDOW_MS });
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'local';
  return limiter.allow(`${bucket}:${ip}`);
}
