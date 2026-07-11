import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES } from '@copyforge/core';
import {
  addManualMarket,
  enqueueGenerationJob,
  listMarkets,
  projects,
  swapMarketRanks,
  updateMarket,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

/** Market Selection Engine (WO-012). */
export const marketsRouter = router({
  list: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const rows = await listMarkets(ctx.workspaceId, input.projectId);
    return rows.map((r) => ({
      id: r.id,
      rank: r.rank,
      label: r.label,
      rationale: r.rationale,
      scoreTotal: r.scoreTotal ? Number(r.scoreTotal) : null,
      origin: ((r.profile as { origin?: string } | null)?.origin ?? 'engine') as 'engine' | 'user',
      scores: (r.profile as { scores?: Record<string, number> } | null)?.scores ?? null,
      avatarHint: (r.profile as { avatar_hint?: string } | null)?.avatar_hint ?? '',
    }));
  }),

  /** Run the engine. Generation-class: the G1 hard stop applies. */
  run: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    try {
      const jobId = await enqueueGenerationJob({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        type: JOB_TYPES.marketSelect,
        payload: { projectId: input.projectId },
      });
      return { jobId };
    } catch (err) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: err instanceof Error ? err.message : 'G1 hard stop.',
      });
    }
  }),

  swap: workspaceProcedure
    .input(projectScoped.extend({ marketIdA: z.string().length(26), marketIdB: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await swapMarketRanks({ workspaceId: ctx.workspaceId, ...input });
      return { ok: true as const };
    }),

  update: workspaceProcedure
    .input(
      projectScoped.extend({
        marketId: z.string().length(26),
        label: z.string().min(1).max(255).optional(),
        rationale: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await updateMarket({ workspaceId: ctx.workspaceId, ...input });
      return { ok: true as const };
    }),

  addManual: workspaceProcedure
    .input(projectScoped.extend({ label: z.string().min(1).max(255), rationale: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const id = await addManualMarket({ workspaceId: ctx.workspaceId, ...input });
        return { id };
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : 'Could not add market.',
        });
      }
    }),
});
