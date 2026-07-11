import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './rateLimit.js';

describe('sliding-window rate limiter (WO-056)', () => {
  it('caps per key per window, slides, and isolates keys', () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 1000, now: () => t });

    expect(limiter.allow('ws-a')).toBe(true);
    expect(limiter.allow('ws-a')).toBe(true);
    expect(limiter.allow('ws-a')).toBe(true);
    expect(limiter.allow('ws-a')).toBe(false); // 4th in-window refused
    expect(limiter.remaining('ws-a')).toBe(0);
    expect(limiter.allow('ws-b')).toBe(true); // other workspaces unaffected

    t = 500;
    expect(limiter.allow('ws-a')).toBe(false); // window still covers the burst
    t = 1001;
    expect(limiter.allow('ws-a')).toBe(true); // slid past the first hits
    expect(limiter.remaining('ws-a')).toBe(2);
  });

  it('sweep drops idle keys without changing behavior', () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 100, now: () => t });
    expect(limiter.allow('ws-a')).toBe(true);
    t = 500;
    limiter.sweep();
    expect(limiter.allow('ws-a')).toBe(true);
  });

  it('rejects nonsense configuration', () => {
    expect(() => new SlidingWindowLimiter({ limit: 0, windowMs: 1000 })).toThrow();
  });
});
