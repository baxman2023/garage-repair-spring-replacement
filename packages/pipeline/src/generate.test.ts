import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, parseGeneratedBlocks, vocQuoteRate } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  addVocSource,
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  getCurrentAssetVersion,
  getDb,
  insertMarketPhrases,
  jobs,
  listClaims,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
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
    console.warn('[generate.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const VOC = ['the spring snapped at six a.m.', 'I just want it to work'];

const LETTER_BLOCKS = {
  blocks: [
    { id: 'headline', role: 'headline', text: 'The Six A.M. Snap That Traps Your Car Inside' },
    { id: 'lead', role: 'lead', text: `You heard it before you saw it — ${VOC[0]}. And you thought: ${VOC[1]}.` },
    { id: 'mechanism', role: 'mechanism', text: 'The TripleCycle Coil beats spring fatigue where standard coils fail.' },
    { id: 'bullets', role: 'bullets', text: '• The 4-second garage check that predicts a snap weeks early…' },
    { id: 'proof', role: 'proof', text: 'Rated ten thousand cycles in independent bench tests.' },
    { id: 'offer', role: 'offer', text: 'Install + parts ($500 value) — yours at $349, backed by our 90-day make-it-right guarantee. Twelve slots weekly.' },
    { id: 'close', role: 'close', text: 'Claim one of the twelve slots now.' },
    { id: 'ps', role: 'ps', text: 'P.S. Every week both crews book out. Never think about your door again.' },
  ],
};

const CLAIMS = {
  claims: [
    { text: 'Rated ten thousand cycles in independent bench tests.', proof_ref: '10,000-cycle rating' },
    { text: 'predicts a snap weeks early', proof_ref: '' },
  ],
};

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-gen-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Gen test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: {
      schema_version: '1',
      name: 'SpringGuard Pro',
      category: 'garage-repair',
      mechanism: { problem_mechanism: 'spring fatigue', solution_mechanism: 'high-cycle coils', name: 'TripleCycle Coil' },
      proof_assets: [{ type: 'statistic', ref: '10,000-cycle rating', strength: 'strong' }],
      price: { amount: 349, model: 'one-time' },
    },
  });
  const [offerId] = await saveOfferVariants({
    workspaceId,
    projectId,
    variants: [{ schema_version: '1', name: 'Total Protection', price: { amount: 349, model: 'one-time' } }],
  });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({
      label: `Crowd ${i}`,
      rationale: 'starving',
      total: 80 - i,
      profile: { scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4 } },
    })),
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
      avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screeching door' },
      starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
      awareness_stage: 'problem',
      awareness_justification: 'Feels the symptom daily.',
      sophistication: 2,
      sophistication_justification: 'Low exposure.',
      resident_emotion: 'quiet dread',
      core_desire: 'forget the door exists',
      objections: ['diy', 'upsell', 'quality', 'price', 'trust'],
      voc_corpus_ref: '',
      channels_ranked: ['search'],
      entry_conversation: 'Is this going to snap on me?',
    },
  });
  const sourceId = await addVocSource({ workspaceId, projectId, marketId, kind: 'paste', rawContent: 'x' });
  await insertMarketPhrases({
    workspaceId,
    marketId,
    sourceId,
    phrases: VOC.map((phrase) => ({ phrase, kind: 'pain' as const })),
  });
  return { workspaceId, projectId, marketId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId() };
}

describe('sales letter generator (WO-022)', () => {
  it('generates contract-valid blocks, registers claims, enters G3 automatically', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(LETTER_BLOCKS)); // draft
    mock.pushText(JSON.stringify(CLAIMS)); // claims extraction

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'sales_letter' }),
    );

    // Asset + version, prompt pinned.
    const assetRows = await tenantDb(workspaceId).findMany(
      (await import('@copyforge/db')).assets,
      undefined,
    );
    const asset = assetRows.find((a) => a.projectId === projectId)!;
    expect(asset.type).toBe('sales_letter');
    expect(asset.promptVersionId).not.toBeNull(); // pinned (WO-008)
    const version = await getCurrentAssetVersion(workspaceId, asset.id);
    const parsed = parseGeneratedBlocks({ blocks: version!.blocks }); // contract-valid
    expect(parsed.blocks.length).toBe(8);

    // Every claim registered.
    const claims = await listClaims(workspaceId, asset.id);
    expect(claims.length).toBe(2);
    expect(claims.find((c) => c.proofRef === '10,000-cycle rating')!.status).toBe('proven');
    expect(claims.find((c) => !c.proofRef)!.status).toBe('flagged');

    // Enters G3 automatically: a council job was enqueued for the asset.
    const queued = await getDb().select().from(jobs).where(eq(jobs.workspaceId, workspaceId));
    const councilJob = queued.find((j) => j.type === 'asset.council');
    expect(councilJob).toBeDefined();
    expect((councilJob!.payload as { assetId: string }).assetId).toBe(asset.id);

    // §1.2 block stack: genome + market/VOC + generator prompt, all cached.
    const draftCall = mock.calls[0]!;
    expect(draftCall.req.system?.length).toBe(3);
    expect(draftCall.req.system![0]!.text).toContain('PERSUASION GENOME');
    expect(draftCall.req.system![1]!.text).toContain('MARKET PROFILE');
    expect(draftCall.req.system![1]!.text).toContain('VOICE OF CUSTOMER');
    expect(draftCall.req.system!.every((b) => b.cache)).toBe(true);
    // Offer + profile ride the dynamic block with the structure selector.
    expect(draftCall.req.messages[0].content).toContain('STRUCTURE: pas'); // problem-aware default
    expect(draftCall.req.messages[0].content).toContain('Total Protection');

    // The letter demonstrably quotes VOC (WO-014 harness).
    const fullText = parsed.blocks.map((b) => b.text).join('\n');
    expect(vocQuoteRate(fullText, VOC).rate).toBe(1);

    expect(asset.status).toBe('draft'); // council job will advance it when claimed
  });

  it('honors an explicit structure selector', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(LETTER_BLOCKS));
    mock.pushText(JSON.stringify({ claims: [] }));
    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'sales_letter', options: { structure: '4ps' } }),
    );
    expect(mock.calls[0]!.req.messages[0].content).toContain('STRUCTURE: 4ps');
  });

  it('refuses to generate for an undiagnosed market (WO-013 assertion)', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-gen-test-111111');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Undiagnosed' });
    await saveProfileVersion({ workspaceId, projectId, profile: { schema_version: '1', name: 'P' } });
    const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [{ schema_version: '1', name: 'O' }] });
    await selectOffer({ workspaceId, projectId, offerId: offerId! });
    await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
    });
    const markets = await listMarkets(workspaceId, projectId);
    const mock = new MockTransport();
    await expect(
      createGenerateHandler({ transport: mock })(
        makeJob(workspaceId, { projectId, marketId: markets[0]!.id, assetType: 'sales_letter' }),
      ),
    ).rejects.toThrow();
    expect(mock.calls.length).toBe(0);
  });
});
