import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { closePool, getDb, markets, tenantDb } from './index.js';

/**
 * Regression test (WO-006): MariaDB returns JSON columns as strings, so the
 * schema uses a custom json type that parses on read. Without it, every JSON
 * column (profiles, blocks, fallback chains, …) would silently round-trip as a
 * string. Verify objects/arrays come back as objects/arrays.
 */

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[json.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('json columns round-trip on MariaDB', () => {
  it('returns parsed objects/arrays, not strings', async () => {
    if (!dbUp) return;
    const ws = newId();
    const db = tenantDb(ws);
    const profile = { avatar: { age: '35-44' }, objections: ['too expensive', 'no time'] };
    const id = await db.insert(markets, {
      projectId: newId(),
      rank: 1,
      label: 'Test market',
      profile,
    });

    const row = await getDb().select().from(markets).where(eq(markets.id, id)).limit(1);
    const got = row[0]!.profile;
    expect(typeof got).toBe('object');
    expect(got).toEqual(profile);
    expect((got as { objections: string[] }).objections[0]).toBe('too expensive');
  });
});
