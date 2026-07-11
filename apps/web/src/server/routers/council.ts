import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { gateReports, getAsset, listCouncilReviewsForAsset, tenantDb } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Per-asset Council report + escalation notes (WO-020). */
export const councilRouter = router({
  report: workspaceProcedure
    .input(z.object({ assetId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });

      const grouped = await listCouncilReviewsForAsset(ctx.workspaceId, input.assetId);
      const g3Reports = (
        await tenantDb(ctx.workspaceId).findMany(gateReports, eq(gateReports.assetId, input.assetId))
      )
        .filter((r) => r.gate === 'G3')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return {
        asset: { id: asset.id, type: asset.type, status: asset.status },
        versions: grouped.map(({ version, reviews }) => ({
          versionId: version.id,
          version: version.version,
          createdAt: version.createdAt,
          reviews: reviews.map((r) => ({
            lens: r.lens,
            score: r.score,
            verdict: r.verdict,
            notes: r.notes,
          })),
        })),
        latestGate: g3Reports[0]
          ? {
              pass: g3Reports[0].pass,
              report: g3Reports[0].report,
              at: g3Reports[0].createdAt,
            }
          : null,
      };
    }),
});
