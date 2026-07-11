import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES, marketProfileSchema, parseMarketProfile } from '@copyforge/core';
import {
  addManualMarket,
  applyMarketProfile,
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
    return rows.map((r) => {
      const profile = (r.profile ?? {}) as Record<string, unknown>;
      let diagnosed = false;
      try {
        parseMarketProfile(profile);
        diagnosed = true;
      } catch {
        diagnosed = false;
      }
      return {
        id: r.id,
        rank: r.rank,
        label: r.label,
        rationale: r.rationale,
        scoreTotal: r.scoreTotal ? Number(r.scoreTotal) : null,
        origin: ((profile as { origin?: string }).origin ?? 'engine') as 'engine' | 'user',
        scores: (profile as { scores?: Record<string, number> }).scores ?? null,
        avatarHint: (profile as { avatar_hint?: string }).avatar_hint ?? '',
        diagnosed,
        profile,
      };
    });
  }),

  /** Enqueue Schwartz diagnosis jobs for every market (generation-class → G1). */
  profileAll: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const rows = await listMarkets(ctx.workspaceId, input.projectId);
    if (rows.length === 0) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run market selection first.' });
    }
    try {
      const jobIds: string[] = [];
      for (const m of rows) {
        jobIds.push(
          await enqueueGenerationJob({
            workspaceId: ctx.workspaceId,
            projectId: input.projectId,
            type: JOB_TYPES.marketProfile,
            payload: { projectId: input.projectId, marketId: m.id },
          }),
        );
      }
      return { jobIds };
    } catch (err) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: err instanceof Error ? err.message : 'G1 hard stop.',
      });
    }
  }),

  /** Editor save: full market_profile.json (contract-validated). */
  updateProfile: workspaceProcedure
    .input(projectScoped.extend({ marketId: z.string().length(26), profile: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      let profile: z.infer<typeof marketProfileSchema>;
      try {
        profile = parseMarketProfile(input.profile);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            err instanceof Error
              ? `Profile does not match the market_profile contract: ${err.message}`
              : 'Invalid profile.',
        });
      }
      await applyMarketProfile({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        marketId: input.marketId,
        profile,
      });
      // Editor saves are user intent — mark the row user-origin so it survives re-runs.
      await updateMarket({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        marketId: input.marketId,
      });
      return { ok: true as const };
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
