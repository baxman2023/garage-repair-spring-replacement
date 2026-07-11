import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AssetBlock } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  createAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
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
import { eq } from 'drizzle-orm';
import { ASSET_GENERATE_JOB, createGenerateHandler } from './generate.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[shortForm.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const script = (slug: string, angle: string, hookWords = 7, bodyWords = 40) => ({
  blocks: [
    { id: 'hook', role: 'hook', text: Array.from({ length: hookWords }, (_v, i) => `snap${'abcdefg'[i % 7]}`).join(' ') },
    { id: 'tease', role: 'mechanism', text: `${angle} — the real reason springs fail is not age. ${Array.from({ length: bodyWords - 12 }, (_v, i) => `w${'abcdefg'[i % 7]}`).join(' ')}` },
    { id: 'cta', role: 'cta', text: 'The full breakdown is in the long video on this page.', meta: { ctaTarget: slug } },
  ],
});

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string; vslId: string; slug: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-sf-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'SF test' });
  await saveProfileVersion({ workspaceId, projectId, profile: { schema_version: '1', name: 'P', category: 'garage-repair' } });
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
      schema_version: '1', rank: 1, label: markets[0]!.label,
      avatar: { age_range: '30-45', identity: 'homeowner', situation: 's' },
      starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
      awareness_stage: 'problem', awareness_justification: 'x', sophistication: 2, sophistication_justification: 'x',
      resident_emotion: 'dread', core_desire: 'peace', objections: ['a','b','c','d','e'],
      voc_corpus_ref: '', channels_ranked: ['search'], entry_conversation: 'Snap?',
    },
  });
  // Parent VSL with slug.
  const vslId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  const slug = `vsl-${vslId.slice(-8).toLowerCase()}`;
  await tenantDb(workspaceId).update(assetsTable, { slug }, eq(assetsTable.id, vslId));
  await insertAssetVersion({
    workspaceId, assetId: vslId,
    blocks: [{ id: 'hook', role: 'hook', text: 'vsl hook' }, { id: 'b', role: 'lead', text: 'x' }, { id: 'c', role: 'close', text: 'y' }],
    createdBy: 'system',
  });
  return { workspaceId, projectId, marketId, vslId, slug };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId() };
}

describe('short-form feeder hooks (WO-024)', () => {
  it('creates 3 feeders ≤90 words, hook first ≤3s, CTA on the VSL slug, linked to the parent', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId, slug } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ scripts: [script(slug, 'fear'), script(slug, 'curiosity'), script(slug, 'proof')] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'short_form_video' }),
    );

    const rows = await tenantDb(workspaceId).findMany(assetsTable, eq(assetsTable.type, 'short_form_video'));
    expect(rows.length).toBe(3);
    for (const asset of rows) {
      expect(asset.parentAssetId).toBe(vslId); // linked to the parent VSL
      const version = await getCurrentAssetVersion(workspaceId, asset.id);
      const blocks = version!.blocks as AssetBlock[];
      expect(blocks[0]!.role).toBe('hook'); // hook first
      expect(blocks[0]!.meta!.timestampEnd as number).toBeLessThanOrEqual(3.1); // ≤3s
      const totalWords = blocks.map((b) => b.text).join(' ').split(/\s+/).filter(Boolean).length;
      expect(totalWords).toBeLessThanOrEqual(90);
      const cta = blocks.find((b) => b.role === 'cta')!;
      expect((cta.meta as { ctaTarget: string }).ctaTarget).toBe(slug); // references VSL slug
      expect((version!.meta as { parentVslSlug: string }).parentVslSlug).toBe(slug);
    }
    // Prompt carried the slug for the model.
    expect(mock.calls[0].req.messages[0].content).toContain(`PARENT VSL SLUG: ${slug}`);
  });

  it('rejects a feeder over 90 words', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, slug } = await setup();
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({ scripts: [script(slug, 'fear', 7, 120), script(slug, 'b'), script(slug, 'c')] }),
    );
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'short_form_video' })),
    ).rejects.toThrow(/≤ 90/);
  });

  it('rejects a slow hook and a CTA missing the slug', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, slug } = await setup();
    const slowHook = script(slug, 'fear', 20); // ~7s hook
    let mock = new MockTransport();
    mock.pushText(JSON.stringify({ scripts: [slowHook, script(slug, 'b'), script(slug, 'c')] }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'short_form_video' })),
    ).rejects.toThrow(/3 seconds/);

    const wrongSlug = script('vsl-wrong', 'fear');
    mock = new MockTransport();
    mock.pushText(JSON.stringify({ scripts: [wrongSlug, script(slug, 'b'), script(slug, 'c')] }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'short_form_video' })),
    ).rejects.toThrow(/slug/);
  });
});
