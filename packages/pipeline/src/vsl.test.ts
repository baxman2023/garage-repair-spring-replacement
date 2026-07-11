import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, totalDurationSeconds, wordCount, type AssetBlock } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  getDb,
  listAssetVersions,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  assets as assetsTable,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_GENERATE_JOB, createGenerateHandler } from './generate.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[vsl.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_v, i) => `${seed}${'abcdefghijklmnopqrstuvwxyz'[i % 26]}`).join(' ');

/** A variant whose hook (first block) verbalizes the promise; realistic sizes. */
const variant = (lead: string, promiseFirst = true) => ({
  lead_type: lead,
  blocks: [
    {
      id: 'hook',
      role: 'hook',
      // When the promise is NOT first, pad the hook past thirty seconds so the
      // flagged block genuinely lands late.
      text: `Never get stranded by a snapped spring again. [PAUSE] It costs $349 — in 2023 that saved 1,200 owners. ${words(promiseFirst ? 30 : 120, 'h')}`,
      meta: promiseFirst ? { verbalizesPromise: true } : {},
    },
    { id: 'lead', role: 'lead', text: words(300, 'l'), meta: promiseFirst ? {} : { verbalizesPromise: true } },
    { id: 'mechanism', role: 'mechanism', text: `The TripleCycle Coil. ${words(280, 'm')}` },
    { id: 'proof', role: 'proof', text: words(300, 'p') },
    { id: 'offer', role: 'offer', text: words(250, 'o') },
    { id: 'close', role: 'close', text: words(200, 'c') },
  ],
  retention_map: [
    { drop_after_block: 'mechanism', reason: 'technical fatigue', open_loop_block: 'lead' },
    { drop_after_block: 'offer', reason: 'price shock', open_loop_block: 'proof' },
  ],
});

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-vsl-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'VSL test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair', price: { amount: 349, model: 'one-time' } },
  });
  const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [{ schema_version: '1', name: 'O' }] });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
  });
  const markets = await listMarkets(workspaceId, projectId);
  const marketId = markets[0]!.id;
  await applyMarketProfile({
    workspaceId,
    projectId,
    marketId,
    profile: {
      schema_version: '1',
      rank: 1,
      label: markets[0]!.label,
      avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
      starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
      awareness_stage: 'problem',
      awareness_justification: 'daily symptom',
      sophistication: 2,
      sophistication_justification: 'low',
      resident_emotion: 'dread',
      core_desire: 'forget the door',
      objections: ['a', 'b', 'c', 'd', 'e'],
      voc_corpus_ref: '',
      channels_ranked: ['search'],
      entry_conversation: 'Is this going to snap?',
    },
  });
  return { workspaceId, projectId, marketId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId() };
}

describe('VSL generator (WO-023)', () => {
  it('persists 3 sibling variants with timestamps, retention maps, and spoken conventions', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ variants: [variant('story'), variant('big_promise'), variant('secret')] }));
    for (let i = 0; i < 3; i++) mock.pushText(JSON.stringify({ claims: [] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'vsl' }),
    );

    const assetRows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const asset = assetRows.find((a) => a.type === 'vsl')!;
    const versions = await listAssetVersions(workspaceId, asset.id);
    expect(versions.length).toBe(3); // sibling versions
    expect(new Set(versions.map((v) => (v.meta as { leadType: string }).leadType))).toEqual(
      new Set(['story', 'big_promise', 'secret']),
    );

    const blocks = versions[0]!.blocks as AssetBlock[];
    // Spoken conventions enforced on stored text.
    const hook = blocks.find((b) => b.id === 'hook')!;
    expect(hook.text).toContain('three hundred forty-nine dollars');
    expect(hook.text).toContain('a while back'); // in 2023 →
    expect(hook.text).toContain('one thousand two hundred');
    expect(hook.text).not.toContain('[PAUSE]');
    expect(hook.text).not.toMatch(/\d/);

    // 170-WPM timestamps: sequential and within ±5% of wordcount/170.
    let prevEnd = 0;
    for (const b of blocks) {
      expect(b.meta!.timestampStart).toBeCloseTo(prevEnd, 0);
      prevEnd = b.meta!.timestampEnd as number;
    }
    const totalWords = wordCount(blocks.map((b) => b.text).join(' '));
    const expected = (totalWords / 170) * 60;
    expect(Math.abs(totalDurationSeconds(blocks) - expected) / expected).toBeLessThan(0.05);

    // Retention map: open-loop blocks flagged and planted before drop points.
    expect(blocks.find((b) => b.id === 'lead')!.meta!.openLoop).toBe(true);
    expect(blocks.find((b) => b.id === 'proof')!.meta!.openLoop).toBe(true);
    expect((versions[0]!.meta as { retentionMap: unknown[] }).retentionMap).toHaveLength(2);

    // Promise verbalized inside the first 30 seconds.
    expect((hook.meta as { verbalizesPromise?: boolean }).verbalizesPromise).toBe(true);
    expect(hook.meta!.timestampStart).toBeLessThan(30);

    // Auto-G3.
    const { jobs } = await import('@copyforge/db');
    const queued = await getDb().select().from(jobs);
    expect(queued.some((j) => j.type === 'asset.council' && (j.payload as { assetId: string }).assetId === asset.id)).toBe(true);
  });

  it('rejects a script whose promise lands after 30 seconds', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    // Promise flagged on the SECOND block (starts ~66s in) for all variants.
    mock.pushText(
      JSON.stringify({ variants: [variant('story', false), variant('big_promise', false), variant('secret', false)] }),
    );
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'vsl' })),
    ).rejects.toThrow(/first 30 seconds/);
  });

  it('rejects an open loop planted after its predicted drop-off', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const bad = variant('story');
    bad.retention_map = [{ drop_after_block: 'lead', reason: 'bail', open_loop_block: 'close' }];
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ variants: [bad, variant('big_promise'), variant('secret')] }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'vsl' })),
    ).rejects.toThrow(/Retention map violation/);
  });
});
