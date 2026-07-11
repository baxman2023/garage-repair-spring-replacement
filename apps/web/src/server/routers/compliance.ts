import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES } from '@copyforge/core';
import {
  enqueueJob,
  gateReports,
  getAsset,
  getCurrentAssetVersion,
  recordComplianceAck,
  tenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/**
 * Compliance pre-flight (WO-032 / G6): latest report with line refs, re-run,
 * and the acknowledge-with-audit path for lint WARNINGS. Errors and
 * strict-mode claim failures have no acknowledgment path — fix and re-run.
 */

const assetScoped = z.object({ assetId: z.string().length(26) });

async function requireAsset(ctx: { workspaceId: string }, assetId: string) {
  const asset = await getAsset(ctx.workspaceId, assetId);
  if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
  return asset;
}

export const complianceRouter = router({
  latest: workspaceProcedure.input(assetScoped).query(async ({ ctx, input }) => {
    const asset = await requireAsset(ctx, input.assetId);
    const reports = (
      await tenantDb(ctx.workspaceId).findMany(gateReports, eq(gateReports.assetId, input.assetId))
    )
      .filter((r) => r.gate === 'G6')
      // ULID tiebreak: consecutive runs can land in the same second.
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return {
      asset: { id: asset.id, type: asset.type, status: asset.status },
      report: reports[0] ? { pass: reports[0].pass, at: reports[0].createdAt, detail: reports[0].report } : null,
    };
  }),

  run: workspaceProcedure.input(assetScoped).mutation(async ({ ctx, input }) => {
    const asset = await requireAsset(ctx, input.assetId);
    const jobId = await enqueueJob({
      workspaceId: ctx.workspaceId,
      type: JOB_TYPES.assetCompliance,
      payload: { projectId: asset.projectId, assetId: asset.id, marketId: asset.marketId },
    });
    return { jobId };
  }),

  /** Acknowledge WARNING findings for the CURRENT version — always audited. */
  acknowledge: workspaceProcedure
    .input(
      assetScoped.extend({
        findingKeys: z.array(z.string().min(3)).min(1),
        reason: z.string().trim().min(3, 'A reason is required — this is audited.'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await requireAsset(ctx, input.assetId);
      const version = await getCurrentAssetVersion(ctx.workspaceId, asset.id);
      if (!version) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Asset has no version.' });
      const ackId = await recordComplianceAck({
        workspaceId: ctx.workspaceId,
        assetId: asset.id,
        assetVersionId: version.id,
        actorUserId: ctx.auth.user.id,
        reason: input.reason,
        findingKeys: input.findingKeys,
      });
      // Re-run the gate so the report reflects the acknowledgment.
      await enqueueJob({
        workspaceId: ctx.workspaceId,
        type: JOB_TYPES.assetCompliance,
        payload: { projectId: asset.projectId, assetId: asset.id, marketId: asset.marketId },
      });
      return { ackId };
    }),
});
