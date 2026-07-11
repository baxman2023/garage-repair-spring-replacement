import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES, parseMarketProfile } from '@copyforge/core';
import {
  buildStrategySnapshot,
  enqueueGenerationJob,
  getG2Status,
  listMarketPhrases,
  listMarkets,
  projects,
  recordG2,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

/** Strategy Review — G2 (WO-015). */
export const strategyRouter = router({
  /** The side-by-side review payload: 5 markets + diagnosis + VOC highlights. */
  review: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const rows = await listMarkets(ctx.workspaceId, input.projectId);
    const markets = await Promise.all(
      rows.map(async (r) => {
        let diagnosed = false;
        let profile: Record<string, unknown> | null = null;
        try {
          profile = parseMarketProfile(r.profile) as unknown as Record<string, unknown>;
          diagnosed = true;
        } catch {
          profile = null;
        }
        const phrases = await listMarketPhrases(ctx.workspaceId, r.id);
        return {
          id: r.id,
          rank: r.rank,
          label: r.label,
          scoreTotal: r.scoreTotal ? Number(r.scoreTotal) : null,
          diagnosed,
          profile,
          vocCount: phrases.length,
          vocHighlights: phrases.slice(0, 4).map((p) => ({ phrase: p.phrase, kind: p.kind })),
        };
      }),
    );
    const status = await getG2Status(ctx.workspaceId, input.projectId);
    return { markets, g2: status };
  }),

  /** Regenerate one market's diagnosis (per-market action). */
  regenerateMarket: workspaceProcedure
    .input(projectScoped.extend({ marketId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      try {
        const jobId = await enqueueGenerationJob({
          workspaceId: ctx.workspaceId,
          projectId: input.projectId,
          type: JOB_TYPES.marketProfile,
          payload: { projectId: input.projectId, marketId: input.marketId },
        });
        return { jobId };
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : 'G1 hard stop.',
        });
      }
    }),

  /** Approve the strategy: snapshot the 5 diagnosed profiles, record G2. */
  approve: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    let snapshot;
    try {
      snapshot = await buildStrategySnapshot(ctx.workspaceId, input.projectId);
    } catch (err) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: err instanceof Error ? err.message : 'Strategy is not ready for approval.',
      });
    }
    await recordG2({ workspaceId: ctx.workspaceId, projectId: input.projectId, snapshot });
    return { hash: snapshot.hash };
  }),
});
