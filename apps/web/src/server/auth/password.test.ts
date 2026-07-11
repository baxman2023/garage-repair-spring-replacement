import { describe, expect, it } from 'vitest';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password';

describe('password hashing', () => {
  it('round-trips a valid password', () => {
    const stored = hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('wrong password!!', stored)).toBe(false);
  });

  it('salts each hash (same password → different strings)', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });

  it('rejects passwords shorter than the minimum', () => {
    expect(() => hashPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow();
    expect(() => hashPassword('x'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it('never verifies against missing or malformed stored values', () => {
    expect(verifyPassword('anything', null)).toBe(false);
    expect(verifyPassword('anything', undefined)).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$not$enough')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$16384$8$1$zz$zz')).toBe(false);
  });
});
