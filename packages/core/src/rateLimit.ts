/**
 * Sliding-window rate limiter (WO-056). In-memory, per-process — sized for
 * per-workspace API caps on a single-node PM2 deployment (spec §2). The clock
 * is injectable so tests are deterministic.
 */

export interface RateLimiterOptions {
  /** Requests allowed per window per key. */
  limit: number;
  windowMs: number;
  now?: () => number;
}

export class SlidingWindowLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(opts: RateLimiterOptions) {
    if (opts.limit < 1 || opts.windowMs < 1) throw new Error('limit and windowMs must be ≥ 1');
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? (() => Date.now());
  }

  /** True if this call is allowed; records it when it is. */
  allow(key: string): boolean {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Remaining allowance for a key right now. */
  remaining(key: string): number {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    return Math.max(0, this.limit - list.length);
  }

  /** Drop stale keys (housekeeping for long-lived processes). */
  sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, list] of this.hits) {
      const live = list.filter((t) => t > cutoff);
      if (live.length === 0) this.hits.delete(key);
      else this.hits.set(key, live);
    }
  }
}
