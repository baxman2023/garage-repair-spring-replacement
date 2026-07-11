import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  ASSET_GATES,
  approveAsset,
  blockAsset,
  gateReportDetail,
  listMarkets,
  overrideGate,
  projects,
  projectGateGrid,
  type TenantDb,
} from '@copyforge/db';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';

/**
 * Gate dashboard (WO-033): the single control surface. Market × asset grid
 * with G3–G7 states, gate-report drill-ins, and owner-only block / approve /
 * override actions — bulk-capable, every one audited with a reason.
 */

const projectScoped = z.object({ projectId: z.string().length(26) });
const gateEnum = z.enum(ASSET_GATES);

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const gatesRouter = router({
  /** The live grid (the client polls; worker updates surface on refetch). */
  grid: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const [rows, markets] = await Promise.all([
      projectGateGrid(ctx.workspaceId, input.projectId),
      listMarkets(ctx.workspaceId, input.projectId),
    ]);
    const marketLabel = new Map(markets.map((m) => [m.id, { rank: m.rank, label: m.label }]));
    return {
      gates: ASSET_GATES,
      rows: rows.map((r) => ({
        ...r,
        market: r.marketId ? (marketLabel.get(r.marketId) ?? null) : null,
      })),
    };
  }),

  /** Drill-in: the full latest report for one asset × gate. */
  report: workspaceProcedure
    .input(z.object({ assetId: z.string().length(26), gate: gateEnum }))
    .query(async ({ ctx, input }) => {
      const detail = await gateReportDetail(ctx.workspaceId, input.assetId, input.gate);
      if (!detail) throw new TRPCError({ code: 'NOT_FOUND', message: 'No report for that gate yet.' });
      return detail;
    }),

  /** Owner-only override — bulk-capable; audited; writes overridden_by. */
  override: ownerProcedure
    .input(
      z.object({
        assetIds: z.array(z.string().length(26)).min(1),
        gate: gateEnum,
        reason: z.string().trim().min(3, 'A reason is required — overrides are audited.'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      for (const assetId of input.assetIds) {
        await overrideGate({
          workspaceId: ctx.workspaceId,
          assetId,
          gate: input.gate,
          actorUserId: ctx.auth.user.id,
          reason: input.reason,
        });
      }
      return { overridden: input.assetIds.length };
    }),

  /** Owner-only block — bulk-capable; audited. */
  block: ownerProcedure
    .input(
      z.object({
        assetIds: z.array(z.string().length(26)).min(1),
        reason: z.string().trim().min(3, 'A reason is required — blocks are audited.'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      for (const assetId of input.assetIds) {
        await blockAsset({
          workspaceId: ctx.workspaceId,
          assetId,
          actorUserId: ctx.auth.user.id,
          reason: input.reason,
        });
      }
      return { blocked: input.assetIds.length };
    }),

  /** Owner-only approve (packaging → approved) — bulk-capable; audited. */
  approve: ownerProcedure
    .input(z.object({ assetIds: z.array(z.string().length(26)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      for (const assetId of input.assetIds) {
        await approveAsset({ workspaceId: ctx.workspaceId, assetId, actorUserId: ctx.auth.user.id });
      }
      return { approved: input.assetIds.length };
    }),
});
