import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AssetBlock } from '@copyforge/core';
import { createClient, MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  createAsset,
  getDb,
  insertAssetVersion,
  listGenomePacks,
  queryGenomeComponents,
  retrieveGenome,
  tenantDb,
  challengers,
  controls,
  markets,
  projects,
  subscriptions,
} from '@copyforge/db';
import { runLearningNightly } from './learning.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[learning.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const BLOCKS: AssetBlock[] = [
  { id: 'hook', role: 'hook', text: 'The bang at six in the morning is your spring giving up.' },
  { id: 'offer', role: 'offer', text: 'Same-day replacement with the torsion-matched spring.' },
  { id: 'cta', role: 'cta', text: 'Book the fix before the second spring goes.' },
];

const decomposition = (niche: string) =>
  JSON.stringify({
    niche,
    channel: 'internal',
    awareness: 'problem',
    components: [
      { type: 'lead', content: { summary: 'symptom-led open', evidence: 'The bang at six in the morning', pattern: 'symptom hook' }, confidence: 0.9, tags: ['winner'] },
      { type: 'mechanism_name', content: { summary: 'named mechanism', evidence: 'torsion-matched spring', pattern: 'unique mechanism' }, confidence: 0.85, tags: [] },
      { type: 'close', content: { summary: 'loss-framed urgency close', evidence: 'before the second spring goes', pattern: 'looming-loss close' }, confidence: 0.8, tags: [] },
    ],
  });

async function seedWinner(workspaceId: string) {
  const db = tenantDb(workspaceId);
  const projectId = await db.insert(projects, { name: 'Garage Springs' });
  const marketId = await db.insert(markets, {
    projectId, rank: 1, label: 'M1', schemaVersion: '1', profile: { origin: 'engine' },
  });
  const controlAsset = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  const winnerAsset = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  await insertAssetVersion({ workspaceId, assetId: winnerAsset, blocks: BLOCKS, createdBy: 'system' });
  const controlId = await db.insert(controls, { projectId, marketId, assetType: 'vsl', assetId: controlAsset });
  await db.insert(challengers, { controlId, assetId: winnerAsset, status: 'won' });
  return { projectId, winnerAsset };
}

describe('learning loop nightly (WO-048 acceptance)', () => {
  it('eats winners into the workspace genome layer; idempotent; entitled pack refresh; no leaks', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const stranger = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-learning-test-000');
    await seedWinner(workspaceId);
    await tenantDb(workspaceId).insert(subscriptions, { status: 'active', genomeFeed: true });

    const mock = new MockTransport();
    mock.pushText(decomposition('garage-springs'));
    const ai = createClient({ transport: mock });

    const first = await runLearningNightly(ai, workspaceId);
    expect(first).toMatchObject({ winners: 1, decomposed: 1, skipped: 0, packsRefreshed: 1 });

    // Components landed on the WORKSPACE layer, tagged internal-winner.
    const mine = await queryGenomeComponents({ workspaceId, niche: 'garage-springs' });
    expect(mine).toHaveLength(3);
    for (const c of mine) {
      expect(c.workspaceId).toBe(workspaceId);
      expect(c.isInternalWinner).toBe(true);
    }

    // ACCEPTANCE: idempotent — the second run eats nothing new.
    const second = await runLearningNightly(ai, workspaceId); // no queued mock response needed
    expect(second).toMatchObject({ winners: 1, decomposed: 0, skipped: 1, packsRefreshed: 1 });
    expect(await queryGenomeComponents({ workspaceId, niche: 'garage-springs' })).toHaveLength(3);
    expect(mock.calls).toHaveLength(1); // no second model spend

    // ACCEPTANCE: cross-workspace leak fails closed — query, retrieval, packs.
    expect(await queryGenomeComponents({ workspaceId: stranger, niche: 'garage-springs' })).toHaveLength(0);
    expect(await retrieveGenome({ workspaceId: stranger, niche: 'garage-springs' })).toHaveLength(0);
    const strangerPacks = (await listGenomePacks(stranger, 'garage-springs')).filter(
      (p) => p.workspaceId !== null,
    );
    expect(strangerPacks).toHaveLength(0);

    // The entitled workspace's pack curates exactly its winner components.
    const packs = (await listGenomePacks(workspaceId, 'garage-springs')).filter(
      (p) => p.workspaceId === workspaceId,
    );
    expect(packs).toHaveLength(1);
    const ids = (packs[0]!.definition as { componentIds: string[] }).componentIds;
    expect([...ids].sort()).toEqual(mine.map((c) => c.id).sort());
  });

  it('without the Genome Feed entitlement the pack refresh is skipped (components still private)', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-learning-test-001');
    await seedWinner(workspaceId);

    const mock = new MockTransport();
    mock.pushText(decomposition('garage-springs'));
    const summary = await runLearningNightly(createClient({ transport: mock }), workspaceId);
    expect(summary).toMatchObject({ winners: 1, decomposed: 1, packsRefreshed: 0 });

    expect(await queryGenomeComponents({ workspaceId, niche: 'garage-springs' })).toHaveLength(3);
    expect(
      (await listGenomePacks(workspaceId, 'garage-springs')).filter((p) => p.workspaceId === workspaceId),
    ).toHaveLength(0);
  });
});
