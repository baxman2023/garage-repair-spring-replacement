import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, DEFAULT_DESLOP_CONFIG, type AssetBlock } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  addVocSource,
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  insertClaims,
  insertMarketPhrases,
  listAssetVersions,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  setAssetStatus,
  tenantDb,
  gateReports,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_DESLOP_JOB, createDeslopHandler } from './deslop.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[deslop.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

/** The WO-030 fixture sloppy draft, as blocks. */
const SLOPPY_BLOCKS: AssetBlock[] = [
  {
    id: 'lead',
    role: 'lead',
    text: `In today's world, garage door maintenance is something that homeowners frequently delve into without fully understanding the complexities involved in the mechanical systems.`,
  },
  {
    id: 'body',
    role: 'body',
    text: `Navigating the complexities of torsion spring replacement requires a comprehensive understanding of the underlying engineering principles that govern the operation. It is important to note that professional intervention is generally recommended for these situations. Furthermore, the associated risks are considerable and should not be underestimated by anyone.`,
  },
];

/** Calibrated rewrite: grade in the written band, zero tells, sourced specifics only. */
const CLEAN_BLOCKS: AssetBlock[] = [
  {
    id: 'lead',
    role: 'lead',
    text: `The bang woke Dan at six in the morning, and his garage door refused to move an inch. The spring had snapped overnight, leaving the family car trapped inside on the morning of his most important meeting.`,
  },
  {
    id: 'body',
    role: 'body',
    text: `Here is the part nobody mentions. Standard torsion springs are rated ten thousand cycles by the independent testing lab, and a busy household door burns through that allowance in about seven years. Ours is different. The SpringGuard replacement coil is engineered and certified for double the standard rating, and the complete installation costs three hundred forty nine dollars. One visit. Finished before lunch. Book the appointment today and forget the door entirely.`,
  },
];

async function setup(withVoiceSamples = false): Promise<{
  workspaceId: string;
  projectId: string;
  marketId: string;
  assetId: string;
}> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-g5-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'G5 test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: {
      schema_version: '1',
      name: 'SpringGuard',
      category: 'garage-repair',
      price: { amount: 349, model: 'one-time' },
      ...(withVoiceSamples
        ? { founder_voice_samples: ['I fixed doors for twenty years. Springs lie to you.'] }
        : {}),
    },
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
  // VOC — the legal source of the rewrite's specifics.
  const sourceId = await addVocSource({ workspaceId, projectId, marketId, kind: 'paste' });
  await insertMarketPhrases({
    workspaceId,
    marketId,
    sourceId,
    phrases: [
      { phrase: 'it snapped at six in the morning', kind: 'pain' },
      { phrase: 'lasted about seven years then bang', kind: 'pain' },
      { phrase: 'just want one visit and done', kind: 'desire' },
    ],
  });

  const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
  const version = await insertAssetVersion({ workspaceId, assetId, blocks: SLOPPY_BLOCKS, createdBy: 'system' });
  await insertClaims({
    workspaceId,
    assetId,
    assetVersionId: version.id,
    claims: [{ text: 'rated ten thousand cycles by the independent testing lab' }],
  });
  // Walk the status machine to where a G4 pass leaves the asset.
  await setAssetStatus(workspaceId, assetId, 'council');
  await setAssetStatus(workspaceId, assetId, 'focus_group');
  await setAssetStatus(workspaceId, assetId, 'deslop');
  return { workspaceId, projectId, marketId, assetId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_DESLOP_JOB, payload, attempts: 1, jobRunId: newId() };
}

const g5Reports = async (workspaceId: string, assetId: string) =>
  (await tenantDb(workspaceId).findMany(gateReports, eq(gateReports.assetId, assetId))).filter(
    (g) => g.gate === 'G5',
  );

describe('De-Slop Gate — G5 (WO-030)', () => {
  it('sloppy fixture exits within the grade band with zero tells (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ blocks: CLEAN_BLOCKS })); // targeted rewrite

    await createDeslopHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, assetId, marketId }),
    );

    // No voice samples → the only AI call is the rewrite, and its brief targets
    // exactly the failing dimensions.
    expect(mock.calls).toHaveLength(1);
    const brief = String(mock.calls[0]!.req.messages[0]!.content);
    expect(brief).toContain('FAILING DIMENSIONS');
    expect(brief).toContain('AI-tell hits');
    expect(brief).toContain('SOURCE MATERIAL');

    const reports = await g5Reports(workspaceId, assetId);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.pass).toBe(true);
    const report = reports[0]!.report as {
      metrics: { grade: number; tells: string[] };
      band: [number, number];
      loops: unknown[];
    };
    expect(report.metrics.grade).toBeGreaterThanOrEqual(report.band[0]);
    expect(report.metrics.grade).toBeLessThanOrEqual(report.band[1]);
    expect(report.metrics.tells).toEqual([]);
    expect(report.loops).toHaveLength(2); // original measure + post-rewrite measure

    expect((await listAssetVersions(workspaceId, assetId))).toHaveLength(2);
    const current = await getCurrentAssetVersion(workspaceId, assetId);
    expect((current!.meta as { deslopLoop: number }).deslopLoop).toBe(1);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('compliance');
  });

  it('the injector cannot introduce numbers absent from profile/VOC/claims (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const invented = CLEAN_BLOCKS.map((b) =>
      b.id === 'body'
        ? { ...b, text: `${b.text} Ninety-seven percent of installers agree.` }
        : b,
    );
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ blocks: invented }));

    await expect(
      createDeslopHandler({ transport: mock })(makeJob(workspaceId, { projectId, assetId, marketId })),
    ).rejects.toThrow(/injector violation.*ninety seven/i);
    expect((await listAssetVersions(workspaceId, assetId))).toHaveLength(1); // rewrite not persisted
  });

  it('voice-match gates when founder samples exist, and the style card lands in the report', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup(true);
    const mock = new MockTransport();
    const voice = (score: number) =>
      JSON.stringify({
        style_card: {
          tone: 'blunt tradesman',
          sentence_habits: 'short jabs',
          signature_phrases: ['Springs lie to you.'],
          never_says: ['delve'],
        },
        match_score: score,
        notes: '',
      });
    mock.pushText(voice(40)); // score the sloppy original
    mock.pushText(JSON.stringify({ blocks: CLEAN_BLOCKS })); // rewrite
    mock.pushText(voice(88)); // score the rewrite

    await createDeslopHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, assetId, marketId }),
    );

    expect(mock.calls).toHaveLength(3);
    const rewriteBrief = String(mock.calls[1]!.req.messages[0]!.content);
    expect(rewriteBrief).toContain('FOUNDER STYLE CARD');
    expect(rewriteBrief).toContain('Voice-match score 40');
    const reports = await g5Reports(workspaceId, assetId);
    expect(reports[0]!.pass).toBe(true);
    const report = reports[0]!.report as { styleCard: { tone: string }; metrics: { voiceMatch: number } };
    expect(report.styleCard.tone).toBe('blunt tradesman');
    expect(report.metrics.voiceMatch).toBe(88);
  });

  it('exhausted rewrite loops fail the gate and block the asset', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ blocks: SLOPPY_BLOCKS })); // "rewrite" that fixes nothing

    await createDeslopHandler({ transport: mock }, { ...DEFAULT_DESLOP_CONFIG, maxRewriteLoops: 1 })(
      makeJob(workspaceId, { projectId, assetId, marketId }),
    );

    const reports = await g5Reports(workspaceId, assetId);
    expect(reports[0]!.pass).toBe(false);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('blocked');
  });
});
