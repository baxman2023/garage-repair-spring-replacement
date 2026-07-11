import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type QuizBand, type QuizQuestion, type QuizScoring } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { saveQuizDefinition, getQuizForProject } from './quizStore.js';
import {
  completeQuizSession,
  publicQuizView,
  quizFunnelMetrics,
  recordQuizAnswer,
  startQuizSession,
} from './quizRuntime.js';
import { events, jobs, markets, projects, quizLeads, quizSessions } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[quizRuntime.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function fixtureQuestions(marketIds: string[]): QuizQuestion[] {
  return [
    ...Array.from({ length: 5 }, (_v, qi) => ({
      id: `q${qi + 1}`,
      kind: 'routing' as const,
      text: `Question ${qi + 1}?`,
      options: marketIds.map((marketId, oi) => ({
        id: `q${qi + 1}-o${oi + 1}`,
        text: `Option ${oi + 1}`,
        weights: { [marketId]: 3 },
        disqualify: false,
      })),
    })),
    {
      id: 'budget',
      kind: 'prequal' as const,
      text: 'Budget?',
      options: [
        { id: 'ready', text: 'Ready', weights: {}, disqualify: false },
        { id: 'browsing', text: 'Browsing', weights: {}, disqualify: true },
      ],
    },
  ];
}

const SCORING: QuizScoring = {
  method: 'weighted_sum',
  lead_capture: { headline: 'Where do we send it?', button: 'Send', fields: ['email'] },
  decline: { headline: 'Not the right fit', body: 'Free guide instead.' },
};

async function setup(): Promise<{
  workspaceId: string;
  projectId: string;
  quizId: string;
  slug: string;
  marketIds: string[];
}> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Quiz runtime test' });
  const marketIds: string[] = [];
  for (let rank = 1; rank <= 5; rank++) {
    marketIds.push(
      await tenantDb(workspaceId).insert(markets, {
        projectId,
        rank,
        label: `M${rank}`,
        schemaVersion: '1',
        profile: { origin: 'engine' },
      }),
    );
  }
  const bands: QuizBand[] = marketIds.map((marketId, i) => ({
    id: `band-${i + 1}`,
    marketId,
    label: `Bucket ${i + 1}`,
    resultBlocks: [
      { id: 'hl', role: 'headline', text: `Bucket ${i + 1} result` },
      { id: 'cta', role: 'cta', text: 'Book now' },
    ],
  }));
  const slug = `quiz-test-${newId().slice(-10).toLowerCase()}`;
  const quizId = await saveQuizDefinition({
    workspaceId,
    projectId,
    slug,
    questions: fixtureQuestions(marketIds),
    scoring: SCORING,
    bands,
    webhookUrl: 'https://crm.example.com/hooks/leads',
  });
  return { workspaceId, projectId, quizId, slug, marketIds };
}

describe('quiz runtime (WO-040)', () => {
  it('start → answers → complete: lead routed, events emitted, webhook queued', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, quizId, slug, marketIds } = await setup();

    const session = await startQuizSession({ slug });
    expect(session).not.toBeNull();
    // Idempotent restart with the same ref: no duplicate session/event.
    await startQuizSession({ slug, sessionRef: session!.sessionRef });
    const sessions = await tenantDb(workspaceId).findMany(quizSessions, eq(quizSessions.quizDefinitionId, quizId));
    expect(sessions).toHaveLength(1);

    // Answer everything toward market 3, qualify on budget.
    for (let i = 1; i <= 5; i++) {
      await recordQuizAnswer({ slug, sessionRef: session!.sessionRef, questionId: `q${i}`, optionId: `q${i}-o3` });
    }
    await recordQuizAnswer({ slug, sessionRef: session!.sessionRef, questionId: 'budget', optionId: 'ready' });
    await expect(
      recordQuizAnswer({ slug, sessionRef: session!.sessionRef, questionId: 'q1', optionId: 'nope' }),
    ).rejects.toThrow(/Unknown question or option/);

    const completion = await completeQuizSession({
      slug,
      sessionRef: session!.sessionRef,
      contact: { email: 'lead@example.com' },
    });
    expect(completion.disqualified).toBe(false);
    expect(completion.band!.marketId).toBe(marketIds[2]);
    expect(completion.band!.resultBlocks.some((b) => b.role === 'cta')).toBe(true);

    const leads = await tenantDb(workspaceId).findMany(quizLeads, eq(quizLeads.quizDefinitionId, quizId));
    expect(leads).toHaveLength(1);
    expect(leads[0]!.marketId).toBe(marketIds[2]);
    expect(leads[0]!.disqualified).toBe(false);

    // Ledger events: quiz_start, quiz_complete, optin — deduped by key.
    const eventRows = (await tenantDb(workspaceId).findMany(events, eq(events.projectId, projectId))).map((e) => e.type);
    expect(eventRows.sort()).toEqual(['optin', 'quiz_complete', 'quiz_start']);

    // CRM webhook queued with the full payload.
    const queued = await getDb().select().from(jobs).where(eq(jobs.workspaceId, workspaceId));
    const hook = queued.find((j) => j.type === 'webhook.deliver')!;
    expect(hook).toBeDefined();
    const payload = hook.payload as { url: string; body: { band: string; lead: { email: string }; answers: Record<string, string> } };
    expect(payload.url).toBe('https://crm.example.com/hooks/leads');
    expect(payload.body.band).toBe('band-3');
    expect(payload.body.lead.email).toBe('lead@example.com');
    expect(Object.keys(payload.body.answers)).toHaveLength(6);

    // Funnel metrics.
    expect(await quizFunnelMetrics(workspaceId, quizId)).toEqual({
      starts: 1,
      completes: 1,
      optins: 1,
      disqualified: 0,
    });
  });

  it('disqualified path returns decline-with-dignity and tags the lead', async () => {
    if (!dbUp) return;
    const { workspaceId, quizId, slug } = await setup();
    const session = await startQuizSession({ slug });
    // Backfilled answers on complete (offline single-file embed path).
    const completion = await completeQuizSession({
      slug,
      sessionRef: session!.sessionRef,
      contact: { email: 'browsing@example.com' },
      answers: { q1: 'q1-o1', q2: 'q2-o1', q3: 'q3-o1', q4: 'q4-o1', q5: 'q5-o1', budget: 'browsing' },
    });
    expect(completion.disqualified).toBe(true);
    expect(completion.band).toBeNull();
    expect(completion.decline!.headline).toBe('Not the right fit');

    const leads = await tenantDb(workspaceId).findMany(quizLeads, eq(quizLeads.quizDefinitionId, quizId));
    expect(leads[0]!.disqualified).toBe(true); // tagged
    expect(leads[0]!.band).toBeNull();
    expect((await quizFunnelMetrics(workspaceId, quizId)).disqualified).toBe(1);
  });

  it('the public view never exposes weights or disqualify flags', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const row = (await getQuizForProject(workspaceId, projectId))!;
    const view = publicQuizView(row);
    const json = JSON.stringify(view);
    expect(json).not.toContain('weights');
    expect(json).not.toContain('disqualify');
    expect(view.questions).toHaveLength(6);
    expect(view.lead_capture.fields).toEqual(['email']);
  });
});
