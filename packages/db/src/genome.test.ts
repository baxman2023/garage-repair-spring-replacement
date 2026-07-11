import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  addSwipe,
  closePool,
  createGenomePack,
  getDb,
  insertGenomeComponents,
  resolveGenomePack,
  retrieveGenome,
  seedGenomeCorpus,
} from './index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[genome.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const NOW = new Date('2026-07-01T00:00:00Z');

const seedFile = (niche: string) => ({
  niche,
  channel: 'print',
  swipes: [
    {
      key: 'alpha',
      source: 'Classic letter alpha with a story lead.',
      awareness: 'problem',
      components: [
        {
          type: 'lead',
          content: { summary: 'story lead', evidence: 'two young men…', pattern: 'parallel-lives' },
          confidence: 0.95,
          tags: ['classic'],
        },
        {
          type: 'close',
          content: { summary: 'trial close', evidence: 'see what it can do…', pattern: 'trial' },
          confidence: 0.8,
          tags: [],
        },
      ],
    },
    {
      key: 'beta',
      source: 'Headline swipe beta.',
      awareness: 'unaware',
      components: [
        {
          type: 'headline_pattern',
          content: { summary: 'reversal headline', evidence: 'They laughed…', pattern: 'they-laughed' },
          confidence: 0.9,
          tags: [],
        },
      ],
    },
  ],
});

describe('genome retrieval + seed corpus (WO-018)', () => {
  it('seed loader is idempotent and retrieval is deterministic given the seed', async () => {
    if (!dbUp) return;
    const niche = `seed-test-${Date.now()}`;
    const dir = await mkdtemp(join(tmpdir(), 'genome-seed-'));
    await writeFile(join(dir, 'corpus.json'), JSON.stringify(seedFile(niche)));

    const first = await seedGenomeCorpus(dir);
    expect(first).toEqual({ swipes: 2, components: 3 });
    const second = await seedGenomeCorpus(dir);
    expect(second).toEqual({ swipes: 0, components: 0 }); // idempotent

    const workspaceId = newId();
    const run1 = await retrieveGenome({ workspaceId, niche, now: NOW });
    const run2 = await retrieveGenome({ workspaceId, niche, now: NOW });
    expect(run1.map((c) => c.id)).toEqual(run2.map((c) => c.id)); // deterministic
    expect(run1.length).toBe(3);
    // Highest confidence (same recency) leads.
    expect(run1[0]!.type).toBe('lead');
    expect(run1[0]!.weight).toBeGreaterThan(run1[2]!.weight);
  });

  it('filters by type/channel and respects the workspace layer', async () => {
    if (!dbUp) return;
    const niche = `filter-test-${Date.now()}`;
    const mine = newId();
    const other = newId();
    const sharedSwipe = await addSwipe({ workspaceId: null, rawSource: 's', niche, channel: 'meta' });
    await insertGenomeComponents({
      workspaceId: null,
      swipeId: sharedSwipe,
      niche,
      channel: 'meta',
      awareness: null,
      components: [{ type: 'lead', content: { summary: 'shared lead', evidence: 'e' }, confidence: 0.9, tags: [] }],
    });
    const privateSwipe = await addSwipe({ workspaceId: other, rawSource: 'p', niche, channel: 'meta' });
    await insertGenomeComponents({
      workspaceId: other,
      swipeId: privateSwipe,
      niche,
      channel: 'meta',
      awareness: null,
      components: [{ type: 'lead', content: { summary: 'private lead', evidence: 'e' }, confidence: 0.99, tags: [] }],
    });

    const mineView = await retrieveGenome({ workspaceId: mine, niche, type: 'lead', now: NOW });
    expect(mineView.length).toBe(1); // shared only — other's private layer invisible
    const otherView = await retrieveGenome({ workspaceId: other, niche, now: NOW });
    expect(otherView.length).toBe(2);
  });

  it('packs resolve curated ids or filters', async () => {
    if (!dbUp) return;
    const niche = `pack-test-${Date.now()}`;
    const workspaceId = newId();
    const swipeId = await addSwipe({ workspaceId: null, rawSource: 's', niche });
    await insertGenomeComponents({
      workspaceId: null,
      swipeId,
      niche,
      channel: null,
      awareness: null,
      components: [
        { type: 'lead', content: { summary: 'a', evidence: 'e' }, confidence: 0.9, tags: [] },
        { type: 'close', content: { summary: 'b', evidence: 'e' }, confidence: 0.8, tags: [] },
      ],
    });
    const all = await retrieveGenome({ workspaceId, niche, now: NOW });
    const curated = await createGenomePack({
      workspaceId: null,
      niche,
      name: 'curated',
      definition: { componentIds: [all[1]!.id] },
    });
    const filtered = await createGenomePack({
      workspaceId: null,
      niche,
      name: 'leads-only',
      definition: { filters: { type: 'lead' } },
    });
    expect((await resolveGenomePack(workspaceId, curated, NOW)).map((c) => c.id)).toEqual([all[1]!.id]);
    expect((await resolveGenomePack(workspaceId, filtered, NOW)).map((c) => c.type)).toEqual(['lead']);
  });
});
