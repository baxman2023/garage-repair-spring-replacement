import { eq } from 'drizzle-orm';
import type { QuizBand, QuizQuestion, QuizScoring } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { quizDefinitions } from './schema/index.js';

/** Quiz definition persistence (WO-039). One quiz per project (upsert). */

export type QuizDefinitionRow = typeof quizDefinitions.$inferSelect;

export async function saveQuizDefinition(params: {
  workspaceId: string;
  projectId: string;
  slug: string;
  questions: QuizQuestion[];
  scoring: QuizScoring;
  bands: QuizBand[];
  webhookUrl?: string | null;
}): Promise<string> {
  const db = tenantDb(params.workspaceId);
  const existing = await db.findFirst(
    quizDefinitions,
    eq(quizDefinitions.projectId, params.projectId),
  );
  if (existing) {
    await db.update(
      quizDefinitions,
      {
        slug: params.slug,
        questions: params.questions as unknown as Record<string, unknown>[],
        scoring: params.scoring as unknown as Record<string, unknown>,
        bands: params.bands as unknown as Record<string, unknown>[],
        ...(params.webhookUrl !== undefined ? { webhookUrl: params.webhookUrl } : {}),
      },
      eq(quizDefinitions.id, existing.id),
    );
    return existing.id;
  }
  return db.insert(quizDefinitions, {
    projectId: params.projectId,
    slug: params.slug,
    questions: params.questions as unknown as Record<string, unknown>[],
    scoring: params.scoring as unknown as Record<string, unknown>,
    bands: params.bands as unknown as Record<string, unknown>[],
    webhookUrl: params.webhookUrl ?? null,
  });
}

export async function getQuizForProject(
  workspaceId: string,
  projectId: string,
): Promise<QuizDefinitionRow | null> {
  return tenantDb(workspaceId).findFirst(quizDefinitions, eq(quizDefinitions.projectId, projectId));
}

/** Slug lookup is the PUBLIC runtime path (WO-040) — cross-workspace by design. */
export async function getQuizBySlug(slug: string): Promise<QuizDefinitionRow | null> {
  const rows = await getDb().select().from(quizDefinitions).where(eq(quizDefinitions.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/** Editor updates (questions/weights/bands) — partial, validated by the caller. */
export async function updateQuizDefinition(params: {
  workspaceId: string;
  quizId: string;
  questions?: QuizQuestion[];
  scoring?: QuizScoring;
  bands?: QuizBand[];
  webhookUrl?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (params.questions) patch.questions = params.questions;
  if (params.scoring) patch.scoring = params.scoring;
  if (params.bands) patch.bands = params.bands;
  if (params.webhookUrl !== undefined) patch.webhookUrl = params.webhookUrl;
  if (Object.keys(patch).length === 0) return;
  await tenantDb(params.workspaceId).update(quizDefinitions, patch, eq(quizDefinitions.id, params.quizId));
}
