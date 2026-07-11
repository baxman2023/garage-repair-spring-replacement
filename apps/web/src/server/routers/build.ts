import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { FUNNEL_ASSET_SEQUENCE, type FunnelAssetType } from '@copyforge/core';
import {
  buildCacheStats,
  cancelFunnelBuild,
  getBuild,
  latestBuild,
  listBuildSteps,
  listMarkets,
  projects,
  resumeFunnelBuild,
  startFunnelBuild,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/**
 * Fan-out orchestrator (WO-028): the single "Build All" action (post-G2),
 * the per-market × asset progress grid, cancel, resume, and the §1.2 cache
 * hit-rate readout.
 */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const buildRouter = router({
  /** The one-click "Build All" — refuses without a current G2 approval. */
  start: workspaceProcedure
    .input(
      projectScoped.extend({
        marketRanks: z.array(z.number().int().min(1).max(5)).optional(),
        assetTypes: z.array(z.enum(FUNNEL_ASSET_SEQUENCE)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      try {
        const buildId = await startFunnelBuild({
          workspaceId: ctx.workspaceId,
          projectId: input.projectId,
          marketRanks: input.marketRanks,
          assetTypes: input.assetTypes as FunnelAssetType[] | undefined,
        });
        return { buildId };
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : 'Could not start the build.',
        });
      }
    }),

  /** Progress grid + cache stats for the latest (or a specific) build. */
  status: workspaceProcedure
    .input(projectScoped.extend({ buildId: z.string().length(26).optional() }))
    .query(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const build = input.buildId
        ? await getBuild(ctx.workspaceId, input.buildId)
        : await latestBuild(ctx.workspaceId, input.projectId);
      if (!build || build.projectId !== input.projectId) return null;

      const [steps, markets, cache] = await Promise.all([
        listBuildSteps(ctx.workspaceId, build.id),
        listMarkets(ctx.workspaceId, input.projectId),
        buildCacheStats(ctx.workspaceId, build.id),
      ]);
      const marketLabel = new Map(markets.map((m) => [m.id, { rank: m.rank, label: m.label }]));
      return {
        build: { id: build.id, status: build.status, plan: build.plan, startedAt: build.createdAt },
        steps: steps.map((s) => ({
          seq: s.seq,
          marketId: s.marketId,
          market: marketLabel.get(s.marketId) ?? null,
          assetType: s.assetType,
          status: s.status,
          error: s.error,
          assetIds: s.assetIds ?? [],
        })),
        cache: {
          overall: cache.overall,
          perMarket: cache.perMarket.map((m) => ({
            ...m,
            market: marketLabel.get(m.marketId) ?? null,
          })),
        },
      };
    }),

  cancel: workspaceProcedure
    .input(projectScoped.extend({ buildId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      await cancelFunnelBuild(ctx.workspaceId, input.buildId);
      return { ok: true as const };
    }),

  /** Resume-from-failure: re-arm the first non-done step and re-enqueue it. */
  resume: workspaceProcedure
    .input(projectScoped.extend({ buildId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const seq = await resumeFunnelBuild(ctx.workspaceId, input.buildId);
      return { resumedFromSeq: seq };
    }),
});
