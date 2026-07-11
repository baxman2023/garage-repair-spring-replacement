import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activatePromptVersion,
  closePool,
  createPromptVersion,
  getDb,
  getPrompt,
  listPromptVersions,
  resolvePromptForGeneration,
} from './index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[prompts.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('prompt registry + pinning', () => {
  it('versions, activates, and pins so regen is stable across bumps', async () => {
    if (!dbUp) return;
    const name = `unit.${Date.now()}.${Math.random().toString(36).slice(2)}`;

    const v1 = await createPromptVersion({ name, body: 'v1 body' });
    expect(v1.version).toBe(1);
    expect(v1.active).toBe(true);
    expect((await getPrompt(name))?.id).toBe(v1.id);

    // Bump: a new active version deactivates the old.
    const v2 = await createPromptVersion({ name, body: 'v2 body' });
    expect(v2.version).toBe(2);
    expect((await getPrompt(name))?.id).toBe(v2.id);

    // Pinning: an asset pinned to v1 keeps v1's body even though v2 is active.
    const pinned = await resolvePromptForGeneration(name, { pinnedId: v1.id });
    expect(pinned.id).toBe(v1.id);
    expect(pinned.body).toBe('v1 body');

    // Explicit upgrade uses the active version.
    const upgraded = await resolvePromptForGeneration(name, {
      pinnedId: v1.id,
      upgradeToLatest: true,
    });
    expect(upgraded.id).toBe(v2.id);

    // No pin → active.
    expect((await resolvePromptForGeneration(name, {})).id).toBe(v2.id);

    // Re-activating v1 flips the active pointer; history preserved.
    await activatePromptVersion(v1.id);
    expect((await getPrompt(name))?.id).toBe(v1.id);
    const versions = await listPromptVersions(name);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });
});
