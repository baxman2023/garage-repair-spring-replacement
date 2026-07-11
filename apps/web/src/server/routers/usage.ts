import { z } from 'zod';
import { buildCostEstimate, monthlyUsage, projectUsage, workspaceUsage } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** BYO-key usage & cost transparency (WO-053). */

export const usageRouter = router({
  workspace: workspaceProcedure.query(({ ctx }) => workspaceUsage(ctx.workspaceId)),

  project: workspaceProcedure
    .input(z.object({ projectId: z.string().length(26) }))
    .query(({ ctx, input }) => projectUsage(ctx.workspaceId, input.projectId)),

  monthly: workspaceProcedure.query(({ ctx }) => monthlyUsage(ctx.workspaceId)),

  /** Pre-build estimate — shown BEFORE the fan-out launches. */
  buildEstimate: workspaceProcedure
    .input(z.object({ marketCount: z.number().int().min(0).max(5), assetTypeCount: z.number().int().min(0).max(12) }))
    .query(({ ctx, input }) => buildCostEstimate(ctx.workspaceId, input)),
});
