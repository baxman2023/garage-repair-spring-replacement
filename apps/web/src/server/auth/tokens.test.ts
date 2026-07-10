import { describe, expect, it } from 'vitest';
import {
  expiryFrom,
  generateRawToken,
  hashToken,
  isExpired,
  normalizeEmail,
} from './tokens';

describe('auth tokens', () => {
  it('generates 64-hex-char tokens that are unique', () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically to 64 hex chars', () => {
    const raw = 'deadbeef';
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('treats expiry boundary as expired', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(isExpired(new Date('2026-01-01T00:00:00Z'), now)).toBe(true);
    expect(isExpired(new Date('2025-12-31T23:59:59Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-01-01T00:00:01Z'), now)).toBe(false);
  });

  it('computes future expiry', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(expiryFrom(60_000, now).toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('normalizes emails', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});
