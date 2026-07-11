import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  JOB_TYPES,
  quizBandSchema,
  quizQuestionSchema,
  quizScoringSchema,
  simulateRouting,
  validateQuizDefinition,
  type QuizBand,
  type QuizDefinition,
  type QuizQuestion,
  type QuizScoring,
} from '@copyforge/core';
import {
  enqueueGenerationJob,
  getQuizForProject,
  listMarkets,
  projects,
  updateQuizDefinition,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Quiz builder surface (WO-039): generate, inspect + simulate, edit. */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

function toDefinition(row: {
  slug: string;
  questions: unknown;
  scoring: unknown;
  bands: unknown;
}): QuizDefinition {
  return {
    slug: row.slug,
    questions: row.questions as QuizQuestion[],
    scoring: row.scoring as QuizScoring,
    bands: row.bands as QuizBand[],
  };
}

export const quizRouter = router({
  generate: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const jobId = await enqueueGenerationJob({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      type: JOB_TYPES.quizGenerate,
      payload: { projectId: input.projectId },
    });
    return { jobId };
  }),

  /** Definition + a fresh 1,000-set routing simulation. */
  get: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const row = await getQuizForProject(ctx.workspaceId, input.projectId);
    if (!row) return null;
    const def = toDefinition(row);
    const markets = await listMarkets(ctx.workspaceId, input.projectId);
    const marketLabel = new Map(markets.map((m) => [m.id, { rank: m.rank, label: m.label }]));
    return {
      id: row.id,
      slug: row.slug,
      webhookUrl: row.webhookUrl,
      questions: def.questions,
      scoring: def.scoring,
      bands: def.bands.map((b) => ({ ...b, market: marketLabel.get(b.marketId) ?? null })),
      simulation: simulateRouting(def, 1000),
    };
  }),

  /** Editor save: structure validated; simulation returned (UI warns on fail). */
  update: workspaceProcedure
    .input(
      projectScoped.extend({
        questions: z.array(quizQuestionSchema).optional(),
        bands: z.array(quizBandSchema).optional(),
        scoring: quizScoringSchema.optional(),
        webhookUrl: z.string().url().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const row = await getQuizForProject(ctx.workspaceId, input.projectId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No quiz yet — generate one first.' });
      const merged: QuizDefinition = {
        slug: row.slug,
        questions: input.questions ?? (row.questions as QuizQuestion[]),
        scoring: input.scoring ?? (row.scoring as QuizScoring),
        bands: input.bands ?? (row.bands as QuizBand[]),
      };
      try {
        validateQuizDefinition(merged);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Invalid quiz definition.',
        });
      }
      await updateQuizDefinition({
        workspaceId: ctx.workspaceId,
        quizId: row.id,
        questions: input.questions,
        bands: input.bands,
        scoring: input.scoring,
        webhookUrl: input.webhookUrl,
      });
      return { simulation: simulateRouting(merged, 1000) };
    }),
});
