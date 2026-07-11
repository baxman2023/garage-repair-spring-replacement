import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES, renderFocusReportMarkdown, type FocusGroupReport } from '@copyforge/core';
import { enqueueJob, getAsset, latestFocusGroupRun } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/**
 * Synthetic Focus Group (WO-029 / G4): latest run report (marked-up draft
 * annotations), run/re-run, the one-click "fix annotations" pass, and the
 * exportable markdown report.
 */

const assetScoped = z.object({ assetId: z.string().length(26) });

async function requireAsset(ctx: { workspaceId: string }, assetId: string) {
  const asset = await getAsset(ctx.workspaceId, assetId);
  if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
  if (!asset.marketId) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Asset has no market — G4 needs one.' });
  }
  return asset as typeof asset & { marketId: string };
}

export const focusGroupRouter = router({
  latest: workspaceProcedure.input(assetScoped).query(async ({ ctx, input }) => {
    const asset = await requireAsset(ctx, input.assetId);
    const run = await latestFocusGroupRun(ctx.workspaceId, input.assetId);
    return {
      asset: { id: asset.id, type: asset.type, status: asset.status },
      run: run
        ? {
            id: run.id,
            pass: run.pass,
            version: run.version,
            report: run.report as unknown as FocusGroupReport,
            at: run.createdAt,
          }
        : null,
    };
  }),

  /** Run (or re-run) G4 for the asset's current version. */
  run: workspaceProcedure.input(assetScoped).mutation(async ({ ctx, input }) => {
    const asset = await requireAsset(ctx, input.assetId);
    const jobId = await enqueueJob({
      workspaceId: ctx.workspaceId,
      type: JOB_TYPES.assetFocusGroup,
      payload: { projectId: asset.projectId, assetId: asset.id, marketId: asset.marketId },
    });
    return { jobId };
  }),

  /** One-click "fix annotations": revision pass from the latest failing run. */
  fixAnnotations: workspaceProcedure.input(assetScoped).mutation(async ({ ctx, input }) => {
    const asset = await requireAsset(ctx, input.assetId);
    const run = await latestFocusGroupRun(ctx.workspaceId, input.assetId);
    if (!run) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No focus-group run yet — run G4 first.' });
    }
    if (run.pass) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Latest run passed — nothing to fix.' });
    }
    const jobId = await enqueueJob({
      workspaceId: ctx.workspaceId,
      type: JOB_TYPES.assetFocusFix,
      payload: { projectId: asset.projectId, assetId: asset.id, marketId: asset.marketId },
    });
    return { jobId };
  }),

  /** Exportable report (acceptance). */
  exportMarkdown: workspaceProcedure.input(assetScoped).query(async ({ ctx, input }) => {
    await requireAsset(ctx, input.assetId);
    const run = await latestFocusGroupRun(ctx.workspaceId, input.assetId);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'No focus-group run to export.' });
    return { markdown: renderFocusReportMarkdown(run.report as unknown as FocusGroupReport) };
  }),
});
