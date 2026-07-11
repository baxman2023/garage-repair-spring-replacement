import { eq } from 'drizzle-orm';
import { GENERATION_JOB_TYPES, newId } from '@copyforge/core';
import { getDb } from './client.js';
import { featureFlags } from './schema/index.js';

/**
 * Feature flags & kill switches (WO-052). Everything reads from the DB at
 * request/claim time (short cache), so a switch flips behavior WITHOUT a
 * deploy:
 *   - signups_enabled            → magic-link signup for new emails
 *   - harvester_enabled          → all harvest triggers
 *   - worker_generation_enabled  → master pause for token-spending job types
 *   - paused_job_types (value)   → surgical per-type worker pause
 */

export const PAUSED_JOB_TYPES_FLAG = 'paused_job_types';

export type FlagRow = typeof featureFlags.$inferSelect;

export async function getFlag(key: string): Promise<FlagRow | null> {
  const rows = await getDb().select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  return rows[0] ?? null;
}

/** Missing flag rows fall back — kill switches default to "on/allowed". */
export async function flagEnabled(key: string, fallback = false): Promise<boolean> {
  const row = await getFlag(key);
  return row ? row.enabled : fallback;
}

export async function setFlag(params: {
  key: string;
  enabled: boolean;
  description?: string;
  value?: Record<string, unknown> | null;
}): Promise<void> {
  const existing = await getFlag(params.key);
  if (existing) {
    await getDb()
      .update(featureFlags)
      .set({
        enabled: params.enabled,
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.value !== undefined ? { value: params.value } : {}),
      })
      .where(eq(featureFlags.id, existing.id));
    return;
  }
  await getDb().insert(featureFlags).values({
    id: newId(),
    key: params.key,
    enabled: params.enabled,
    description: params.description ?? null,
    value: params.value ?? null,
  });
}

export async function listFlags(): Promise<FlagRow[]> {
  const rows = await getDb().select().from(featureFlags);
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

// --- Worker pause switches ---------------------------------------------------------

export async function setPausedJobTypes(types: string[]): Promise<void> {
  await setFlag({
    key: PAUSED_JOB_TYPES_FLAG,
    enabled: types.length > 0,
    description: 'Job types the worker must not claim (kill switch, WO-052).',
    value: { types: [...new Set(types)].sort() },
  });
  resetPausedJobTypesCache();
}

/**
 * The full pause set the claim loop honors: the surgical list plus every
 * generation type when the master switch is off.
 */
export async function getEffectivePausedJobTypes(): Promise<string[]> {
  const set = new Set<string>();
  const surgical = await getFlag(PAUSED_JOB_TYPES_FLAG);
  if (surgical?.enabled) {
    for (const t of ((surgical.value as { types?: string[] } | null)?.types ?? [])) set.add(t);
  }
  if (!(await flagEnabled('worker_generation_enabled', true))) {
    for (const t of GENERATION_JOB_TYPES) set.add(t);
  }
  return [...set].sort();
}

let pausedCache: { at: number; types: string[] } | null = null;
const PAUSE_CACHE_TTL_MS = 5_000;

/** Cached view for the hot claim path — at most one flag read per 5s. */
export async function pausedJobTypesCached(): Promise<string[]> {
  if (pausedCache && Date.now() - pausedCache.at < PAUSE_CACHE_TTL_MS) return pausedCache.types;
  const types = await getEffectivePausedJobTypes();
  pausedCache = { at: Date.now(), types };
  return types;
}

export function resetPausedJobTypesCache(): void {
  pausedCache = null;
}
