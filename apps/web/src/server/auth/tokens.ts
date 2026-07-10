import { createHash, randomBytes } from 'node:crypto';

/** Magic-link tokens are single-use and expire quickly (spec WO-003). */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** A high-entropy raw token (64 hex chars). Never stored server-side. */
export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

/** sha256 hex of a raw token — this is what we persist and look up by. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** True when `expiresAt` is at or before `now`. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** A future expiry timestamp `ttlMs` from `now`. */
export function expiryFrom(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs);
}

/** Normalize an email for storage/lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
