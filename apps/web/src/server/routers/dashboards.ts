import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  brierTrend,
  funnelCsv,
  listMarkets,
  projectFunnel,
  projects,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Ledger dashboards (WO-046). Control timeline and challenger queue reuse controls.list. */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

async function labelledFunnel(workspaceId: string, projectId: string) {
  const [funnel, markets] = await Promise.all([
    projectFunnel(workspaceId, projectId),
    listMarkets(workspaceId, projectId),
  ]);
  const labels = new Map(markets.map((m) => [m.id, `${m.rank}. ${m.label}`]));
  return { funnel, labels };
}

export const dashboardsRouter = router({
  /** Per-market funnel: traffic → quiz → optin → VSL retention → sale. */
  funnel: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const { funnel, labels } = await labelledFunnel(ctx.workspaceId, input.projectId);
    return {
      markets: funnel.markets.map((m) => ({
        ...m,
        label: m.marketId ? (labels.get(m.marketId) ?? m.marketId) : 'unattributed',
      })),
      total: funnel.total,
    };
  }),

  /** Brier scores in resolution order with a running mean. */
  brierTrend: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    return brierTrend(ctx.workspaceId, input.projectId);
  }),

  /** Deterministic CSV of the funnel for download. */
  exportCsv: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const { funnel, labels } = await labelledFunnel(ctx.workspaceId, input.projectId);
    return { csv: funnelCsv(funnel, labels), filename: `funnel-${input.projectId.slice(-8)}.csv` };
  }),
});
