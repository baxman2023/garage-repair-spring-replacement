import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId, JOB_TYPES } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import {
  flagEnabled,
  getEffectivePausedJobTypes,
  listFlags,
  resetPausedJobTypesCache,
  setFlag,
  setPausedJobTypes,
} from './flagsStore.js';
import { saveHarvestQuery, triggerHarvest } from './harvest.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[flagsStore.test] MariaDB unreachable — skipping');
  }
});
afterEach(async () => {
  if (!dbUp) return;
  // Flags are platform-global: restore the defaults for everyone else.
  await setFlag({ key: 'harvester_enabled', enabled: true });
  await setFlag({ key: 'worker_generation_enabled', enabled: true });
  await setPausedJobTypes([]);
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('feature flags & kill switches (WO-052)', () => {
  it('flags read/write with safe fallbacks for missing rows', async () => {
    if (!dbUp) return;
    expect(await flagEnabled(`never_seeded_${newId()}`, true)).toBe(true);
    expect(await flagEnabled(`never_seeded_${newId()}`)).toBe(false);

    const key = `test_flag_${newId().toLowerCase()}`;
    await setFlag({ key, enabled: true, description: 'test' });
    expect(await flagEnabled(key)).toBe(true);
    await setFlag({ key, enabled: false });
    expect(await flagEnabled(key, true)).toBe(false); // explicit row beats fallback
    expect((await listFlags()).some((f) => f.key === key)).toBe(true);
  });

  it('KILL SWITCH: harvester_enabled off refuses even manual triggers — no deploy needed', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const queryId = await saveHarvestQuery({ workspaceId, niche: 'garage', query: { q: 'garage door' } });

    await setFlag({ key: 'harvester_enabled', enabled: false });
    await expect(triggerHarvest(workspaceId, queryId)).rejects.toThrow(/disabled platform-wide/);

    await setFlag({ key: 'harvester_enabled', enabled: true });
    await expect(triggerHarvest(workspaceId, queryId)).resolves.toBeTruthy();
  });

  it('the master generation switch expands into every token-spending job type', async () => {
    if (!dbUp) return;
    await setPausedJobTypes(['webhook.deliver']);
    expect(await getEffectivePausedJobTypes()).toEqual(['webhook.deliver']);

    await setFlag({ key: 'worker_generation_enabled', enabled: false });
    resetPausedJobTypesCache();
    const paused = await getEffectivePausedJobTypes();
    expect(paused).toContain(JOB_TYPES.assetGenerate);
    expect(paused).toContain(JOB_TYPES.buildStep);
    expect(paused).toContain('webhook.deliver'); // surgical list survives
    expect(paused).not.toContain(JOB_TYPES.assetCompliance); // deterministic gates keep running
    expect(paused).not.toContain(JOB_TYPES.predictionsResolve);
  });
});
