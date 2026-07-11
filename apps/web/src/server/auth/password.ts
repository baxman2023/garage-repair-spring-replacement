import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing (scrypt, node built-in — no dependency). Format:
 *   scrypt$N$r$p$<salt hex>$<key hex>
 * Parameters ride with the hash so they can be raised later without
 * invalidating stored credentials.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  try {
    // Buffer.from(_, 'hex') silently truncates at the first invalid byte — a
    // corrupted hash must fail closed, never become a zero-length comparison.
    const salt = Buffer.from(saltHex!, 'hex');
    const expected = Buffer.from(keyHex!, 'hex');
    if (expected.length !== KEY_LEN || salt.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
