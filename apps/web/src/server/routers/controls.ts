import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES } from '@copyforge/core';
import {
  armMetrics,
  controlLineage,
  enqueueJob,
  listControls,
  listMarkets,
  markChallengerLost,
  projects,
  promoteChallenger,
  setChallengerLive,
  type TenantDb,
} from '@copyforge/db';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';

/** Controls & challengers surface (WO-044). */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const controlsRouter = router({
  list: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const [rows, markets] = await Promise.all([
      listControls(ctx.workspaceId, input.projectId),
      listMarkets(ctx.workspaceId, input.projectId),
    ]);
    const marketLabel = new Map(markets.map((m) => [m.id, { rank: m.rank, label: m.label }]));
    return Promise.all(
      rows.map(async ({ control, challengers }) => ({
        controlId: control.id,
        assetId: control.assetId,
        assetType: control.assetType,
        market: marketLabel.get(control.marketId) ?? null,
        since: control.since,
        metrics: await armMetrics(ctx.workspaceId, control.assetId),
        lineage: await controlLineage(ctx.workspaceId, control.id),
        challengers: await Promise.all(
          challengers.map(async (c) => ({
            id: c.id,
            assetId: c.assetId,
            status: c.status,
            metrics: await armMetrics(ctx.workspaceId, c.assetId),
          })),
        ),
      })),
    );
  }),

  /** Generate a challenger from the control's recorded weaknesses. */
  createChallenger: workspaceProcedure
    .input(z.object({ controlId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const jobId = await enqueueJob({
        workspaceId: ctx.workspaceId,
        type: JOB_TYPES.challengerGenerate,
        payload: { controlId: input.controlId },
      });
      return { jobId };
    }),

  setLive: workspaceProcedure
    .input(z.object({ challengerId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await setChallengerLive({ workspaceId: ctx.workspaceId, challengerId: input.challengerId });
      return { ok: true as const };
    }),

  /** Owner-only: promotion swaps the control (refused below volume/uplift). */
  promote: ownerProcedure
    .input(z.object({ challengerId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const verdict = await promoteChallenger({
          workspaceId: ctx.workspaceId,
          challengerId: input.challengerId,
          actorUserId: ctx.auth.user.id,
        });
        return { verdict };
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : 'Promotion refused.',
        });
      }
    }),

  markLost: ownerProcedure
    .input(z.object({ challengerId: z.string().length(26), reason: z.string().trim().min(3) }))
    .mutation(async ({ ctx, input }) => {
      await markChallengerLost({
        workspaceId: ctx.workspaceId,
        challengerId: input.challengerId,
        reason: input.reason,
      });
      return { ok: true as const };
    }),
});
