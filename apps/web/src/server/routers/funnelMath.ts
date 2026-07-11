import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { computeFunnelMath, funnelMathInputsSchema, type FunnelMathReport } from '@copyforge/core';
import {
  getApprovedOffer,
  latestFunnelMathRun,
  projects,
  recordFunnelMathRun,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

/** Funnel Math (WO-011 / G1). Pure math computed synchronously, then recorded. */
export const funnelMathRouter = router({
  /** Run G1. Requires an approved offer (G0) first — the DAG order is fixed. */
  run: workspaceProcedure
    .input(projectScoped.extend({ inputs: funnelMathInputsSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const offer = await getApprovedOffer(ctx.workspaceId, input.projectId);
      if (!offer) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'G0 first: approve an offer in the Offer Forge before running Funnel Math.',
        });
      }
      const report = computeFunnelMath(input.inputs);
      await recordFunnelMathRun({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        inputs: report.inputs as unknown as Record<string, unknown>,
        outputs: {
          netRevenuePerSale: report.netRevenuePerSale,
          allowableCpa: report.allowableCpa,
          breakevenRoas: report.breakevenRoas,
          channels: report.channels,
        },
        pass: report.pass,
        report: report as unknown as Record<string, unknown>,
      });
      return report;
    }),

  /** Latest recorded run (report always shown, pass or fail). */
  latest: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const row = await latestFunnelMathRun(ctx.workspaceId, input.projectId);
    if (!row) return null;
    return { report: row.report as unknown as FunnelMathReport, pass: row.pass, at: row.createdAt };
  }),
});
