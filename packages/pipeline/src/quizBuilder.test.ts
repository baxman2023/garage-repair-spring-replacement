import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, simulateRouting, type QuizBand, type QuizDefinition, type QuizQuestion, type QuizScoring } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  getDb,
  getQuizBySlug,
  getQuizForProject,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';
import { QUIZ_GENERATE_JOB, createQuizGenerateHandler } from './quizBuilder.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[quizBuilder.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

/** Model output: 6 routing questions where option i signals rank i, one prequal. */
function generatedQuiz(over: Partial<Record<string, unknown>> = {}) {
  return {
    questions: [
      ...Array.from({ length: 6 }, (_v, qi) => ({
        id: `q${qi + 1}`,
        kind: 'routing',
        text: `What does your door do? (${qi + 1})`,
        options: Array.from({ length: 5 }, (_o, oi) => ({
          id: `q${qi + 1}-o${oi + 1}`,
          text: `Symptom ${oi + 1}`,
          weights: { [String(oi + 1)]: 3, [String(((oi + 1) % 5) + 1)]: 1 },
          disqualify: false,
        })),
      })),
      {
        id: 'budget',
        kind: 'prequal',
        text: 'Where are you on budget?',
        options: [
          { id: 'ready', text: 'Ready this month', weights: {}, disqualify: false },
          { id: 'soon', text: 'In the next quarter', weights: {}, disqualify: false },
          { id: 'browsing', text: 'Just browsing', weights: {}, disqualify: true },
        ],
      },
    ],
    lead_capture: { headline: 'Your diagnosis is ready', button: 'Send it to me', fields: ['email'] },
    decline: { headline: 'We are not the right fit today', body: 'Here is our free maintenance guide instead — no hard feelings.' },
    bands: Array.from({ length: 5 }, (_v, i) => ({
      rank: i + 1,
      label: `Bucket ${i + 1}`,
      result_blocks: [
        { id: 'hl', role: 'headline', text: `Your door is a bucket-${i + 1} case.` },
        { id: 'lead', role: 'lead', text: 'Here is exactly what that means.' },
        { id: 'cta', role: 'cta', text: 'Book the fix today.' },
      ],
    })),
    ...over,
  };
}

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-quiz-test-00000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Quiz test' });
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
  for (const m of await listMarkets(workspaceId, projectId)) {
    await applyMarketProfile({
      workspaceId,
      projectId,
      marketId: m.id,
      profile: {
        schema_version: '1',
        rank: m.rank,
        label: m.label,
        avatar: { age_range: '30-45', identity: 'homeowner', situation: `situation ${m.rank}` },
        starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
        awareness_stage: 'problem',
        awareness_justification: 'x',
        sophistication: 2,
        sophistication_justification: 'x',
        resident_emotion: 'dread',
        core_desire: 'forget the door',
        objections: ['a', 'b', 'c', 'd', 'e'],
        voc_corpus_ref: '',
        channels_ranked: ['search'],
        entry_conversation: `entry ${m.rank}`,
      },
    });
  }
  return { workspaceId, projectId };
}

const makeJob = (workspaceId: string, payload: Record<string, unknown>): ClaimedJob => ({
  id: newId(), workspaceId, type: QUIZ_GENERATE_JOB, payload, attempts: 1, jobRunId: newId(),
});

describe('quiz builder (WO-039)', () => {
  it('generates, maps ranks to market ids, passes the routing simulation, persists', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(generatedQuiz()));

    await createQuizGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId }));

    const row = await getQuizForProject(workspaceId, projectId);
    expect(row).not.toBeNull();
    expect(row!.slug).toBe(`quiz-${projectId.slice(-8).toLowerCase()}`);
    expect(await getQuizBySlug(row!.slug)).not.toBeNull();

    const markets = await listMarkets(workspaceId, projectId);
    const marketIds = new Set(markets.map((m) => m.id));
    const bands = row!.bands as unknown as QuizBand[];
    expect(bands).toHaveLength(5);
    for (const band of bands) expect(marketIds.has(band.marketId)).toBe(true);
    expect(bands.every((b) => b.resultBlocks.some((x) => x.role === 'cta'))).toBe(true);

    const questions = row!.questions as unknown as QuizQuestion[];
    // Weights were re-keyed from ranks to real market ids.
    const weightKeys = questions.flatMap((q) => q.options.flatMap((o) => Object.keys(o.weights)));
    expect(weightKeys.length).toBeGreaterThan(0);
    for (const key of weightKeys) expect(marketIds.has(key)).toBe(true);

    // The stored definition routes 1,000 synthetic respondents correctly.
    const def: QuizDefinition = {
      slug: row!.slug,
      questions,
      scoring: row!.scoring as unknown as QuizScoring,
      bands,
    };
    const sim = simulateRouting(def, 1000);
    expect(sim.pass).toBe(true);
    expect((row!.scoring as { decline: { headline: string } }).decline.headline).toContain('not the right fit');

    // The quiz optin forecast records with the definition (WO-045).
    const { predictions } = await import('@copyforge/db');
    const forecast = await tenantDb(workspaceId).findMany(predictions, undefined);
    expect(forecast.some((p) => p.assetId === row!.id && p.metric === 'quiz_optin_rate')).toBe(true);
  });

  it('rejects incoherent routing (simulation gate) before persisting', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    // Sabotage that SURVIVES structural validation but cannot route: every
    // option weights two markets EQUALLY at 3, so scoring constantly ties and
    // the band-order tiebreak swallows the higher-ranked buckets.
    const bad = generatedQuiz();
    for (const q of (bad.questions as Array<{ kind: string; options: Array<{ id: string; weights: Record<string, number> }> }>)) {
      if (q.kind !== 'routing') continue;
      q.options.forEach((o, oi) => {
        // Options 1-4 tie their own market with the NEXT one at equal weight
        // (own rank numerically lower → still "top-weighted", so structure
        // validates), option 5 stays clean. Scoring then ties constantly and
        // the band-order tiebreak swallows buckets 2-4.
        o.weights = oi < 4 ? { [String(oi + 1)]: 3, [String(oi + 2)]: 3 } : { '5': 3 };
      });
    }
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(bad));
    await expect(
      createQuizGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId })),
    ).rejects.toThrow(/routing simulation failed/);
    expect(await getQuizForProject(workspaceId, projectId)).toBeNull(); // nothing persisted
  });

  it('rejects a quiz with no disqualifying prequal option', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const bad = generatedQuiz();
    (bad.questions as Array<{ id: string; options: Array<{ disqualify: boolean }> }>)
      .find((q) => q.id === 'budget')!
      .options.forEach((o) => (o.disqualify = false));
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(bad));
    await expect(
      createQuizGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId })),
    ).rejects.toThrow(/must disqualify/);
  });
});
