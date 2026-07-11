import { eq } from 'drizzle-orm';
import {
  JOB_TYPES,
  scoreQuizAnswers,
  type QuizBand,
  type QuizDefinition,
  type QuizQuestion,
  type QuizScoring,
} from '@copyforge/core';
import { newId } from '@copyforge/core';
import { tenantDb } from './guard.js';
import { enqueueJob } from './queue.js';
import { recordEvent } from './eventsStore.js';
import { getQuizBySlug, type QuizDefinitionRow } from './quizStore.js';
import { quizAnswers, quizLeads, quizSessions } from './schema/index.js';

/**
 * Quiz runtime persistence (WO-040): sessions → answers → completion.
 * Completion scores server-side (weights never leave the server), writes the
 * lead (band + market routing, disqualified tagging), emits ledger events
 * (quiz_start / quiz_complete / optin), and enqueues the CRM webhook — whose
 * retries/backoff ride the job queue.
 */

export function definitionOf(row: QuizDefinitionRow): QuizDefinition {
  return {
    slug: row.slug,
    questions: row.questions as unknown as QuizQuestion[],
    scoring: row.scoring as unknown as QuizScoring,
    bands: row.bands as unknown as QuizBand[],
  };
}

/** The client-safe subset: weights and disqualify flags never leave the server. */
export function publicQuizView(row: QuizDefinitionRow): {
  slug: string;
  questions: Array<{ id: string; text: string; options: Array<{ id: string; text: string }> }>;
  lead_capture: QuizScoring['lead_capture'];
} {
  const def = definitionOf(row);
  return {
    slug: def.slug,
    questions: def.questions.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    })),
    lead_capture: def.scoring.lead_capture,
  };
}

export async function startQuizSession(params: {
  slug: string;
  sessionRef?: string;
  meta?: Record<string, unknown>;
}): Promise<{ sessionRef: string; workspaceId: string } | null> {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) return null;
  const sessionRef = params.sessionRef ?? newId();
  const db = tenantDb(quiz.workspaceId);
  const existing = await db.findFirst(quizSessions, eq(quizSessions.sessionRef, sessionRef));
  if (!existing) {
    await db.insert(quizSessions, {
      quizDefinitionId: quiz.id,
      sessionRef,
      meta: params.meta ?? null,
    });
    await recordEvent({
      workspaceId: quiz.workspaceId,
      projectId: quiz.projectId,
      type: 'quiz_start',
      sessionRef,
      source: 'quiz',
      dedupeKey: `quiz:${sessionRef}:start`,
    });
  }
  return { sessionRef, workspaceId: quiz.workspaceId };
}

export async function recordQuizAnswer(params: {
  slug: string;
  sessionRef: string;
  questionId: string;
  optionId: string;
}): Promise<boolean> {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) return false;
  const def = definitionOf(quiz);
  const question = def.questions.find((q) => q.id === params.questionId);
  if (!question || !question.options.some((o) => o.id === params.optionId)) {
    throw new Error('Unknown question or option.');
  }
  const db = tenantDb(quiz.workspaceId);
  const session = await db.findFirst(quizSessions, eq(quizSessions.sessionRef, params.sessionRef));
  if (!session) throw new Error('Unknown quiz session.');
  await db.insert(quizAnswers, {
    sessionId: session.id,
    questionId: params.questionId,
    answer: { optionId: params.optionId },
  });
  return true;
}

export interface QuizCompletion {
  disqualified: boolean;
  band: { id: string; label: string; marketId: string; resultBlocks: QuizBand['resultBlocks'] } | null;
  decline: QuizScoring['decline'] | null;
}

export async function completeQuizSession(params: {
  slug: string;
  sessionRef: string;
  contact: Record<string, string>;
  /** Client-supplied answers (single-file embeds may not have streamed them). */
  answers?: Record<string, string>;
}): Promise<QuizCompletion> {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) throw new Error('Unknown quiz.');
  const def = definitionOf(quiz);
  const db = tenantDb(quiz.workspaceId);
  const session = await db.findFirst(quizSessions, eq(quizSessions.sessionRef, params.sessionRef));
  if (!session) throw new Error('Unknown quiz session.');

  // Latest answer per question, scored server-side. Client-supplied answers
  // backfill anything that never streamed in (offline embeds).
  const rows = await db.findMany(quizAnswers, eq(quizAnswers.sessionId, session.id));
  const answers: Record<string, string> = {};
  for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    answers[row.questionId] = (row.answer as { optionId: string }).optionId;
  }
  for (const [questionId, optionId] of Object.entries(params.answers ?? {})) {
    if (answers[questionId]) continue;
    const question = def.questions.find((q) => q.id === questionId);
    if (!question || !question.options.some((o) => o.id === optionId)) continue; // ignore junk
    answers[questionId] = optionId;
    await db.insert(quizAnswers, {
      sessionId: session.id,
      questionId,
      answer: { optionId, backfilled: true },
    });
  }
  const score = scoreQuizAnswers(def, answers);
  const band = score.bandId ? def.bands.find((b) => b.id === score.bandId)! : null;

  await db.insert(quizLeads, {
    sessionId: session.id,
    quizDefinitionId: quiz.id,
    band: score.bandId,
    marketId: score.marketId,
    contact: params.contact,
    disqualified: score.disqualified,
  });
  await db.update(quizSessions, { completedAt: new Date() }, eq(quizSessions.id, session.id));

  await recordEvent({
    workspaceId: quiz.workspaceId,
    projectId: quiz.projectId,
    marketId: score.marketId,
    type: 'quiz_complete',
    value: { band: score.bandId, disqualified: score.disqualified },
    sessionRef: params.sessionRef,
    source: 'quiz',
    dedupeKey: `quiz:${params.sessionRef}:complete`,
  });
  if (Object.values(params.contact).some((v) => v.trim())) {
    await recordEvent({
      workspaceId: quiz.workspaceId,
      projectId: quiz.projectId,
      marketId: score.marketId,
      type: 'optin',
      sessionRef: params.sessionRef,
      source: 'quiz',
      dedupeKey: `quiz:${params.sessionRef}:optin`,
    });
  }

  // CRM webhook out — the queue's retry/backoff is the delivery guarantee.
  if (quiz.webhookUrl) {
    await enqueueJob({
      workspaceId: quiz.workspaceId,
      type: JOB_TYPES.webhookDeliver,
      payload: {
        url: quiz.webhookUrl,
        body: {
          kind: 'quiz_lead',
          slug: quiz.slug,
          sessionRef: params.sessionRef,
          lead: params.contact,
          band: score.bandId,
          marketId: score.marketId,
          disqualified: score.disqualified,
          answers,
        },
      },
      maxAttempts: 6,
    });
  }

  return {
    disqualified: score.disqualified,
    band: band
      ? { id: band.id, label: band.label, marketId: band.marketId, resultBlocks: band.resultBlocks }
      : null,
    decline: score.disqualified ? def.scoring.decline : null,
  };
}

/** Session funnel metrics (WO-040 acceptance). */
export async function quizFunnelMetrics(
  workspaceId: string,
  quizDefinitionId: string,
): Promise<{ starts: number; completes: number; optins: number; disqualified: number }> {
  const db = tenantDb(workspaceId);
  const sessions = await db.findMany(quizSessions, eq(quizSessions.quizDefinitionId, quizDefinitionId));
  const leads = await db.findMany(quizLeads, eq(quizLeads.quizDefinitionId, quizDefinitionId));
  return {
    starts: sessions.length,
    completes: sessions.filter((s) => s.completedAt !== null).length,
    optins: leads.filter((l) => Object.values((l.contact ?? {}) as Record<string, string>).some((v) => v?.trim())).length,
    disqualified: leads.filter((l) => l.disqualified).length,
  };
}
