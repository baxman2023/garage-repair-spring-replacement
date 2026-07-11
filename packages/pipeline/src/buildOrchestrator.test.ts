import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey, type UsageResult } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  buildCacheStats,
  buildStrategySnapshot,
  cancelFunnelBuild,
  closePool,
  getBuild,
  getDb,
  jobs,
  listBuildSteps,
  listMarkets,
  projects,
  recordFunnelMathRun,
  recordG0,
  recordG2,
  resumeFunnelBuild,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  startFunnelBuild,
  tenantDb,
  assets as assetsTable,
  funnelBuildSteps,
  type ClaimedJob,
} from '@copyforge/db';
import { BUILD_STEP_JOB, createBuildStepHandler } from './buildStep.js';
import { ASSET_GENERATE_JOB, createGenerateHandler } from './generate.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[buildOrchestrator.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const marketProfile = (rank: number, label: string) => ({
  schema_version: '1',
  rank,
  label,
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
  starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
  awareness_stage: 'problem' as const,
  awareness_justification: 'daily symptom',
  sophistication: 2,
  sophistication_justification: 'low',
  resident_emotion: 'dread',
  core_desire: 'forget the door',
  objections: ['a', 'b', 'c', 'd', 'e'],
  voc_corpus_ref: '',
  channels_ranked: ['search'],
  entry_conversation: 'Is this going to snap?',
});

/** Full G0→G1→G2 setup: 5 diagnosed markets, approved strategy. */
async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-build-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Build test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
  });
  const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [{ schema_version: '1', name: 'O' }] });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await recordFunnelMathRun({ workspaceId, projectId, inputs: {}, outputs: {}, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
  });
  const markets = await listMarkets(workspaceId, projectId);
  for (const m of markets) {
    await applyMarketProfile({ workspaceId, projectId, marketId: m.id, profile: marketProfile(m.rank, m.label) });
  }
  await recordG2({ workspaceId, projectId, snapshot: await buildStrategySnapshot(workspaceId, projectId) });
  return { workspaceId, projectId };
}

const UPSELL_JSON = JSON.stringify({
  blocks: [
    { id: 'hl', role: 'headline', text: 'Your order is complete — one thing before you go' },
    { id: 'lead', role: 'lead', text: 'The kit you just bought works faster with the tune-up guide.' },
    { id: 'offer', role: 'offer', text: 'One-time 47 dollars, bundled into this order only.' },
    { id: 'cta', role: 'cta', text: 'Add this to my order' },
    { id: 'decline', role: 'body', text: 'No thanks, take me to my order', meta: { section: 'decline' } },
  ],
});
const BUMP_JSON = JSON.stringify({
  headline: 'Wait — add the Emergency Kit for $27?',
  body: 'It is the exact tool set the masterclass uses. One click adds it to this order at the bundle price.',
  checkbox_line: 'Yes, add the Emergency Kit to my order for $27',
});
const CLAIMS_JSON = JSON.stringify({ claims: [] });

/** Push one step's worth of mock output (draft + claims) with usage. */
function pushStep(mock: MockTransport, draft: string, usage?: Partial<UsageResult>): void {
  mock.pushText(draft, usage);
  mock.pushText(CLAIMS_JSON, usage);
}

type Handler = (job: ClaimedJob) => Promise<void>;

/** Run the oldest pending build.step job (simulating the worker loop). */
async function runNextBuildJob(handler: Handler, workspaceId: string): Promise<ClaimedJob | null> {
  const rows = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, BUILD_STEP_JOB), eq(jobs.status, 'pending')))
    .orderBy(asc(jobs.createdAt), asc(jobs.id));
  const row = rows[0];
  if (!row) return null;
  const claimed: ClaimedJob = {
    id: row.id,
    workspaceId,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: row.attempts + 1,
    jobRunId: newId(),
  };
  await handler(claimed);
  await getDb().update(jobs).set({ status: 'done' }).where(eq(jobs.id, row.id));
  return claimed;
}

async function drain(handler: Handler, workspaceId: string, max = 30): Promise<number> {
  let n = 0;
  while (n < max && (await runNextBuildJob(handler, workspaceId))) n++;
  return n;
}

describe('fan-out orchestrator (WO-028)', () => {
  it('Build All requires G2', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-build-nog2-000');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'No G2' });
    await expect(startFunnelBuild({ workspaceId, projectId })).rejects.toThrow(/G2/);
  });

  it('chains market-major, survives a mid-build kill without duplicates, and reports cache hits', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();

    const mock = new MockTransport();
    // Market 1: cold cache. Markets 2 onward: warm (§1.2 acceptance).
    pushStep(mock, UPSELL_JSON, { inputTokens: 1000, cacheReadTokens: 0 });
    pushStep(mock, BUMP_JSON, { inputTokens: 1000, cacheReadTokens: 0 });
    pushStep(mock, UPSELL_JSON, { inputTokens: 100, cacheReadTokens: 900 });
    pushStep(mock, BUMP_JSON, { inputTokens: 100, cacheReadTokens: 900 });
    const handler = createBuildStepHandler({ transport: mock });

    const buildId = await startFunnelBuild({
      workspaceId,
      projectId,
      marketRanks: [1, 2],
      assetTypes: ['upsell', 'order_bump'],
    });

    // Steps: [m1 upsell, m1 bump, m2 upsell, m2 bump] — market-major.
    const steps = await listBuildSteps(workspaceId, buildId);
    expect(steps.map((s) => s.assetType)).toEqual(['upsell', 'order_bump', 'upsell', 'order_bump']);
    expect(steps[0]!.marketId).toBe(steps[1]!.marketId);
    expect(steps[2]!.marketId).toBe(steps[3]!.marketId);
    expect(steps[0]!.marketId).not.toBe(steps[2]!.marketId);

    // Run step 0, then simulate a worker killed AFTER generating but BEFORE
    // bookkeeping: force the step back to 'running' and re-run the same job.
    const job0 = await runNextBuildJob(handler, workspaceId);
    expect(job0).not.toBeNull();
    const callsAfterStep0 = mock.calls.length;
    await tenantDb(workspaceId).update(
      funnelBuildSteps,
      { status: 'running' },
      and(eq(funnelBuildSteps.buildId, buildId), eq(funnelBuildSteps.seq, 0)),
    );
    await handler(job0!); // reaper retry of the same claimed job
    expect(mock.calls.length).toBe(callsAfterStep0); // dedupe: NO regeneration
    const step0 = (await listBuildSteps(workspaceId, buildId))[0]!;
    expect(step0.status).toBe('done');

    // Drain the rest of the chain.
    await drain(handler, workspaceId);

    const build = await getBuild(workspaceId, buildId);
    expect(build!.status).toBe('done');
    const finalSteps = await listBuildSteps(workspaceId, buildId);
    expect(finalSteps.every((s) => s.status === 'done')).toBe(true);

    // No duplicates: exactly one upsell and one bump per market.
    const assets = await tenantDb(workspaceId).findMany(assetsTable, eq(assetsTable.projectId, projectId));
    for (const s of finalSteps) {
      const matching = assets.filter((a) => a.marketId === s.marketId && a.type === s.assetType);
      expect(matching).toHaveLength(1);
      expect(s.assetIds).toEqual(matching.map((a) => a.id));
    }

    // Cache hit rate visible, ≥ target on the second market onward.
    const cache = await buildCacheStats(workspaceId, buildId);
    expect(cache.perMarket).toHaveLength(2);
    expect(cache.perMarket[0]!.hitRate).toBe(0);
    expect(cache.perMarket[1]!.hitRate).toBeCloseTo(0.9, 5);
    expect(cache.overall.cacheReadTokens).toBe(3600);
  });

  it('cancel stops the chain and skips the remaining steps', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const mock = new MockTransport();
    pushStep(mock, UPSELL_JSON);
    const handler = createBuildStepHandler({ transport: mock });

    const buildId = await startFunnelBuild({
      workspaceId,
      projectId,
      marketRanks: [1, 2],
      assetTypes: ['upsell'],
    });
    await runNextBuildJob(handler, workspaceId); // market 1 done
    await cancelFunnelBuild(workspaceId, buildId);

    await drain(handler, workspaceId); // the queued step-1 job must no-op
    const steps = await listBuildSteps(workspaceId, buildId);
    expect(steps.map((s) => s.status)).toEqual(['done', 'skipped']);
    const assets = await tenantDb(workspaceId).findMany(assetsTable, eq(assetsTable.type, 'upsell'));
    expect(assets).toHaveLength(1); // market 2 never generated
    expect((await getBuild(workspaceId, buildId))!.status).toBe('canceled');
  });

  it('upsell contract: exactly one accept CTA and an honest decline block', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const marketId = (await listMarkets(workspaceId, projectId))[0]!.id;
    const job = (payload: Record<string, unknown>): ClaimedJob => ({
      id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId(),
    });

    const twoCtas = JSON.parse(UPSELL_JSON) as { blocks: Array<Record<string, unknown>> };
    twoCtas.blocks.push({ id: 'cta2', role: 'cta', text: 'Or click here instead' });
    let mock = new MockTransport();
    mock.pushText(JSON.stringify(twoCtas));
    await expect(
      createGenerateHandler({ transport: mock })(job({ projectId, marketId, assetType: 'upsell' })),
    ).rejects.toThrow(/exactly one accept CTA/);

    const noDecline = JSON.parse(UPSELL_JSON) as { blocks: Array<{ id: string }> };
    noDecline.blocks = noDecline.blocks.filter((b) => b.id !== 'decline');
    mock = new MockTransport();
    mock.pushText(JSON.stringify(noDecline));
    await expect(
      createGenerateHandler({ transport: mock })(job({ projectId, marketId, assetType: 'upsell' })),
    ).rejects.toThrow(/decline/);
  });

  it('a failing step records its error; resume re-arms and completes', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const fatBump = JSON.stringify({
      headline: 'Wait',
      body: Array.from({ length: 160 }, (_v, i) => `w${'abcdefg'[i % 7]}`).join(' '),
      checkbox_line: 'Yes',
    });
    const mock = new MockTransport();
    mock.pushText(fatBump); // draft rejected before the claims call
    const handler = createBuildStepHandler({ transport: mock });

    const buildId = await startFunnelBuild({
      workspaceId,
      projectId,
      marketRanks: [1],
      assetTypes: ['order_bump'],
    });
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, BUILD_STEP_JOB), eq(jobs.status, 'pending')));
    const claimed: ClaimedJob = {
      id: rows[0]!.id,
      workspaceId,
      type: BUILD_STEP_JOB,
      payload: rows[0]!.payload as Record<string, unknown>,
      attempts: 1,
      jobRunId: newId(),
    };
    await expect(handler(claimed)).rejects.toThrow(/≤ 150/);
    await getDb().update(jobs).set({ status: 'failed' }).where(eq(jobs.id, claimed.id));

    let steps = await listBuildSteps(workspaceId, buildId);
    expect(steps[0]!.status).toBe('failed');
    expect(steps[0]!.error).toMatch(/150/);

    // Resume: re-arm and finish with a good draft.
    pushStep(mock, BUMP_JSON);
    const resumedFrom = await resumeFunnelBuild(workspaceId, buildId);
    expect(resumedFrom).toBe(0);
    await drain(handler, workspaceId);
    steps = await listBuildSteps(workspaceId, buildId);
    expect(steps[0]!.status).toBe('done');
    expect((await getBuild(workspaceId, buildId))!.status).toBe('done');
  });
});
