import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  attachClaimProof,
  claimsFlagReport,
  getAsset,
  getCurrentProfile,
  listCurrentClaims,
  resetClaimToFlagged,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/**
 * Claims inventory + proof linker (WO-031): every claim proven or flagged;
 * the flag report feeds G6 (WO-032). Proof refs come from the product
 * profile's proof_assets.
 */

const assetScoped = z.object({ assetId: z.string().length(26) });

export const claimsRouter = router({
  /** Current-version claims + flag report + the profile's attachable proof assets. */
  list: workspaceProcedure.input(assetScoped).query(async ({ ctx, input }) => {
    const asset = await getAsset(ctx.workspaceId, input.assetId);
    if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
    const [claims, report, profile] = await Promise.all([
      listCurrentClaims(ctx.workspaceId, input.assetId),
      claimsFlagReport(ctx.workspaceId, input.assetId),
      getCurrentProfile(ctx.workspaceId, asset.projectId),
    ]);
    const proofAssets =
      ((profile?.profile as { proof_assets?: { type: string; ref: string; strength: string }[] } | null)
        ?.proof_assets ?? []);
    return {
      asset: { id: asset.id, type: asset.type, status: asset.status },
      report,
      proofAssets,
      claims: claims.map((c) => ({
        id: c.id,
        text: c.text,
        proofRef: c.proofRef,
        status: c.status,
        versionId: c.assetVersionId,
      })),
    };
  }),

  /** Proof linker: attach a proof_asset ref → proven. */
  attachProof: workspaceProcedure
    .input(assetScoped.extend({ claimId: z.string().length(26), proofRef: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
      await attachClaimProof({ workspaceId: ctx.workspaceId, claimId: input.claimId, proofRef: input.proofRef });
      return { ok: true as const };
    }),

  /** Detach proof / send a claim back to flagged. */
  flag: workspaceProcedure
    .input(assetScoped.extend({ claimId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
      await resetClaimToFlagged({ workspaceId: ctx.workspaceId, claimId: input.claimId });
      return { ok: true as const };
    }),
});
