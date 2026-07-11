import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  checkG7,
  nextStepsForAsset,
  parsePageBuildPackage,
  SPOKEN_ASSET_TYPES,
} from '@copyforge/core';
import {
  assets as assetsTable,
  congruenceReport,
  latestPackage,
  listExportsForMarket,
  listMarkets,
  projects,
  utmVariantMaps,
  type TenantDb,
} from '@copyforge/db';
import { exportMarketZip } from '@copyforge/pipeline';
import { router, workspaceProcedure } from '../trpc';

/**
 * Delivery Center (WO-042): one surface from approved build to live-ready
 * files/prompts — packages, exports, prompts, quiz links, message-match
 * snippet, per-market ZIPs, and the "what to do next" checklist per asset.
 */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const deliveryRouter = router({
  overview: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const [markets, assetRows, congruence, maps] = await Promise.all([
      listMarkets(ctx.workspaceId, input.projectId),
      ctx.db.findMany(assetsTable, eq(assetsTable.projectId, input.projectId)),
      congruenceReport(ctx.workspaceId, input.projectId),
      ctx.db.findMany(utmVariantMaps, eq(utmVariantMaps.projectId, input.projectId)),
    ]);
    const mappedAssets = new Set(maps.map((m) => m.assetId));

    const assets = await Promise.all(
      assetRows.map(async (asset) => {
        const pkgRow = await latestPackage(ctx.workspaceId, asset.id);
        const pkg = pkgRow ? parsePageBuildPackage(pkgRow.package) : null;
        const g7 = pkg ? checkG7(pkg) : { pass: false, missing: ['package'] };
        return {
          assetId: asset.id,
          type: asset.type,
          marketId: asset.marketId,
          status: asset.status,
          package: pkg
            ? {
                checksum: pkgRow!.checksum,
                g7Pass: g7.pass,
                filePaths: pkg.renderings.file_paths,
                hasMacaly: pkg.renderings.macaly_prompt.length > 0,
                hasUniversal: pkg.renderings.universal_llm_prompt.length > 0,
              }
            : null,
          nextSteps: nextStepsForAsset({
            status: asset.status,
            g7Pass: g7.pass,
            hasFiles: (pkg?.renderings.file_paths.length ?? 0) > 0,
            hasMacalyPrompt: (pkg?.renderings.macaly_prompt.length ?? 0) > 0,
            hasUniversalPrompt: (pkg?.renderings.universal_llm_prompt.length ?? 0) > 0,
            hasVariantMap: mappedAssets.has(asset.id),
            isSpoken: SPOKEN_ASSET_TYPES.has(asset.type),
          }),
        };
      }),
    );

    return {
      markets: markets.map((m) => ({ id: m.id, rank: m.rank, label: m.label })),
      assets,
      congruence: { mapped: congruence.mapped.length, flagged: congruence.flagged },
    };
  }),

  /** Build (or rebuild) the per-market ZIP; download via /api/exports/download. */
  marketZip: workspaceProcedure
    .input(projectScoped.extend({ marketId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const zip = await exportMarketZip({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        marketId: input.marketId,
      });
      const history = await listExportsForMarket(ctx.workspaceId, input.marketId);
      const row = history.find((h) => h.format === 'zip' && h.checksum === zip.checksum);
      return { exportId: row?.id ?? null, checksum: zip.checksum, fileCount: zip.fileCount };
    }),

  /** Export history for a market (ZIPs + files). */
  exports: workspaceProcedure
    .input(projectScoped.extend({ marketId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const rows = await listExportsForMarket(ctx.workspaceId, input.marketId);
      return rows.slice(0, 20).map((r) => ({
        id: r.id,
        format: r.format,
        path: r.path,
        checksum: r.checksum,
        at: r.createdAt,
      }));
    }),
});
