import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  checkG7,
  compileUniversalPrompt,
  parsePageBuildPackage,
  UNIVERSAL_STACKS,
} from '@copyforge/core';
import { getAsset, getPrompt, latestPackage, updatePackageRenderings } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Page Build Package surface (WO-035/037/038): package, prompts, G7 state. */

const assetScoped = z.object({ assetId: z.string().length(26) });

export const packagesRouter = router({
  latest: workspaceProcedure.input(assetScoped).query(async ({ ctx, input }) => {
    const asset = await getAsset(ctx.workspaceId, input.assetId);
    if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
    const row = await latestPackage(ctx.workspaceId, input.assetId);
    if (!row) return { asset: { id: asset.id, type: asset.type, status: asset.status }, package: null };
    const pkg = parsePageBuildPackage(row.package);
    const g7 = checkG7(pkg);
    return {
      asset: { id: asset.id, type: asset.type, status: asset.status },
      package: {
        id: row.id,
        checksum: row.checksum,
        composedAt: row.createdAt,
        copyBlockCount: pkg.copy_blocks.length,
        g7,
        filePaths: pkg.renderings.file_paths,
        macalyPrompt: pkg.renderings.macaly_prompt,
        universalPrompt: pkg.renderings.universal_llm_prompt,
      },
    };
  }),

  /** Recompile the universal prompt for a stack variant (WO-038 --stack flag). */
  compileUniversal: workspaceProcedure
    .input(assetScoped.extend({ stack: z.enum(UNIVERSAL_STACKS) }))
    .mutation(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
      const row = await latestPackage(ctx.workspaceId, input.assetId);
      if (!row) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No package composed yet.' });
      const template = await getPrompt('universal.build');
      if (!template) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No universal.build template — run the seed.' });
      const pkg = parsePageBuildPackage(row.package);
      const prompt = compileUniversalPrompt(pkg, template.body, input.stack);
      await updatePackageRenderings({
        workspaceId: ctx.workspaceId,
        packageId: row.id,
        renderings: { ...pkg.renderings, universal_llm_prompt: prompt },
      });
      return { stack: input.stack, chars: prompt.length };
    }),
});
