import { createHash } from 'node:crypto';

/**
 * Canonical snapshot hashing (WO-015 / G2, WO-035 / G7). Key order never
 * affects the hash; any value change does.
 */

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** sha256 hex of the canonical form. */
export function snapshotHash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}
