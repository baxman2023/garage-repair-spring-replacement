import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, DEFAULT_FOCUS_GROUP_CONFIG, type AssetBlock, type PersonaResult } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  insertClaims,
  latestFocusGroupRun,
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
import {
  ASSET_FOCUS_FIX_JOB,
  ASSET_FOCUS_GROUP_JOB,
  createFocusFixHandler,
  createFocusGroupHandler,
} from './focusGroup.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[focusGroup.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const BLOCKS: AssetBlock[] = [
  { id: 'hook', role: 'hook', text: 'The bang at six a.m.' },
  { id: 'proof', role: 'proof', text: 'It is rated ten thousand cycles by the independent lab.' },
  { id: 'cta', role: 'cta', text: 'Book the fix today.' },
];
const CLAIM = 'rated ten thousand cycles';

async function setup(): Promise<{
  workspaceId: string;
  projectId: string;
  marketId: string;
  assetId: string;
}> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-fg-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'FG test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
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

  const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
  const version = await insertAssetVersion({ workspaceId, assetId, blocks: BLOCKS, createdBy: 'system' });
  await insertClaims({
    workspaceId,
    assetId,
    assetVersionId: version.id,
    claims: [{ text: CLAIM }],
  });
  await setAssetStatus(workspaceId, assetId, 'council'); // where a G3 pass leaves it
  return { workspaceId, projectId, marketId, assetId };
}

const personaResult = (i: number, over: Partial<PersonaResult> = {}): PersonaResult => ({
  persona_id: `persona-${i + 1}`,
  reached_cta: true,
  attention_drop_block: null,
  disbelief_claims: [],
  bounce_reason: '',
  spouse_test_quote: 'Sounds practical.',
  ...over,
});

/** Queue 4 batches of 5 results (default config) built from one 20-result set. */
function pushCohort(mock: MockTransport, results: PersonaResult[], batchSize = 5): void {
  for (let i = 0; i < results.length; i += batchSize) {
    mock.pushText(JSON.stringify({ results: results.slice(i, i + batchSize) }));
  }
}

function makeJob(
  workspaceId: string,
  type: string,
  payload: Record<string, unknown>,
): ClaimedJob {
  return { id: newId(), workspaceId, type, payload, attempts: 1, jobRunId: newId() };
}

describe('synthetic focus group — G4 (WO-029)', () => {
  it('passing cohort: run persisted, G4 recorded, asset advances to deslop', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const mock = new MockTransport();
    pushCohort(
      mock,
      Array.from({ length: 20 }, (_v, i) =>
        personaResult(i, {
          reached_cta: i < 16, // 80%
          attention_drop_block: i >= 16 ? 'proof' : null,
          disbelief_claims: i < 4 ? [CLAIM] : [], // 20%
          bounce_reason: i >= 16 ? 'price shock' : '',
        }),
      ),
    );

    await createFocusGroupHandler({ transport: mock })(
      makeJob(workspaceId, ASSET_FOCUS_GROUP_JOB, { projectId, assetId, marketId }),
    );

    expect(mock.calls).toHaveLength(4); // batched: 20 personas / 5 per call
    const run = await latestFocusGroupRun(workspaceId, assetId);
    expect(run!.pass).toBe(true);
    const annotations = (run!.annotations as { annotations: { blockId: string }[] }).annotations;
    expect(annotations.every((a) => BLOCKS.some((b) => b.id === a.blockId))).toBe(true);

    const gates = await tenantDb(workspaceId).findMany(gateReports, eq(gateReports.assetId, assetId));
    const g4 = gates.filter((g) => g.gate === 'G4');
    expect(g4).toHaveLength(1);
    expect(g4[0]!.pass).toBe(true);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('deslop');
  });

  it('failing cohort stays in focus_group; fix-annotations revises and re-enters council', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const mock = new MockTransport();
    pushCohort(
      mock,
      Array.from({ length: 20 }, (_v, i) =>
        personaResult(i, {
          reached_cta: i < 8, // 40% — fails the 70% bar
          attention_drop_block: i >= 8 ? 'hook' : null,
          disbelief_claims: i < 12 ? [CLAIM] : [], // 60% — spike
          bounce_reason: i >= 8 ? 'felt like every other ad' : '',
        }),
      ),
    );

    await createFocusGroupHandler({ transport: mock })(
      makeJob(workspaceId, ASSET_FOCUS_GROUP_JOB, { projectId, assetId, marketId }),
    );

    const run = await latestFocusGroupRun(workspaceId, assetId);
    expect(run!.pass).toBe(false);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('focus_group');
    const report = run!.report as { failures: string[] };
    expect(report.failures.join(' ')).toMatch(/reached the CTA/);
    expect(report.failures.join(' ')).toMatch(/spiked disbelief/);

    // One-click fix: revision brief from annotations → new version → council.
    const fixMock = new MockTransport();
    fixMock.pushText(
      JSON.stringify({
        blocks: BLOCKS.map((b) => ({ ...b, text: `${b.text} (sharper)` })),
      }),
    );
    await createFocusFixHandler({ transport: fixMock })(
      makeJob(workspaceId, ASSET_FOCUS_FIX_JOB, { projectId, assetId, marketId }),
    );

    expect(fixMock.calls[0]!.req.messages[0]!.content).toContain('FOCUS GROUP REVISION BRIEF');
    expect(fixMock.calls[0]!.req.messages[0]!.content).toContain('[block hook · hook] ATTENTION DROP');
    const versions = await listAssetVersions(workspaceId, assetId);
    expect(versions).toHaveLength(2);
    const current = await getCurrentAssetVersion(workspaceId, assetId);
    expect((current!.meta as { focusFix: boolean }).focusFix).toBe(true);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('revising');

    const { jobs } = await import('@copyforge/db');
    const queued = await getDb().select().from(jobs);
    expect(
      queued.some(
        (j) =>
          j.type === 'asset.council' &&
          j.workspaceId === workspaceId &&
          (j.payload as { assetId: string }).assetId === assetId,
      ),
    ).toBe(true);
  });

  it('rejects a batch that anchors to a nonexistent block id', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const mock = new MockTransport();
    const results = Array.from({ length: 20 }, (_v, i) => personaResult(i));
    results[3] = personaResult(3, { attention_drop_block: 'ghost' });
    pushCohort(mock, results);
    await expect(
      createFocusGroupHandler({ transport: mock })(
        makeJob(workspaceId, ASSET_FOCUS_GROUP_JOB, { projectId, assetId, marketId }),
      ),
    ).rejects.toThrow(/unknown block "ghost"/);
  });

  it('thresholds and cohort size are config-driven', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, assetId } = await setup();
    const config = { ...DEFAULT_FOCUS_GROUP_CONFIG, personaCount: 4, batchSize: 2, minCtaReachRatio: 1 };
    const mock = new MockTransport();
    pushCohort(mock, Array.from({ length: 4 }, (_v, i) => personaResult(i, { reached_cta: i < 3 })), 2);

    await createFocusGroupHandler({ transport: mock }, config)(
      makeJob(workspaceId, ASSET_FOCUS_GROUP_JOB, { projectId, assetId, marketId }),
    );

    expect(mock.calls).toHaveLength(2); // 4 personas / batch of 2
    const run = await latestFocusGroupRun(workspaceId, assetId);
    expect(run!.pass).toBe(false); // 75% < the configured 100% bar
    expect((run!.report as { cohortSize: number }).cohortSize).toBe(4);
  });
});
