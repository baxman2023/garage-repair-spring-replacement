import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { diffBlocks, JOB_TYPES, type AssetBlock } from '@copyforge/core';
import {
  enqueueJob,
  getAsset,
  getCurrentAssetVersion,
  insertAssetVersion,
  listAssetVersions,
  transitionAssetStatus,
} from '@copyforge/db';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';

const blockSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  text: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Asset framework surface (WO-021). */
export const assetsRouter = router({
  get: workspaceProcedure
    .input(z.object({ assetId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
      const current = await getCurrentAssetVersion(ctx.workspaceId, input.assetId);
      const versions = await listAssetVersions(ctx.workspaceId, input.assetId);
      return {
        id: asset.id,
        projectId: asset.projectId,
        marketId: asset.marketId,
        type: asset.type,
        status: asset.status,
        current: current
          ? { id: current.id, version: current.version, blocks: current.blocks as AssetBlock[] }
          : null,
        versions: versions.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt, createdBy: v.createdBy })),
      };
    }),

  /** Save edited/reordered/locked blocks as a new user version. */
  saveBlocks: workspaceProcedure
    .input(z.object({ assetId: z.string().length(26), blocks: z.array(blockSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, version } = await insertAssetVersion({
        workspaceId: ctx.workspaceId,
        assetId: input.assetId,
        blocks: input.blocks as AssetBlock[],
        createdBy: 'user',
      });
      return { id, version };
    }),

  /** Queue a single-block regeneration (locked blocks refuse in the worker). */
  regenerateBlock: workspaceProcedure
    .input(
      z.object({
        assetId: z.string().length(26),
        blockId: z.string().min(1),
        instruction: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
      const current = await getCurrentAssetVersion(ctx.workspaceId, input.assetId);
      const target = (current?.blocks as AssetBlock[] | undefined)?.find((b) => b.id === input.blockId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Block not found.' });
      if (target.meta?.locked) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Block is locked.' });
      }
      const jobId = await enqueueJob({
        workspaceId: ctx.workspaceId,
        type: JOB_TYPES.assetRegenBlock,
        payload: {
          assetId: input.assetId,
          blockId: input.blockId,
          instruction: input.instruction ?? '',
          projectId: asset.projectId,
        },
      });
      return { jobId };
    }),

  /** Version diff (adds/removes/edits/reorder). */
  diff: workspaceProcedure
    .input(z.object({ assetId: z.string().length(26), fromVersionId: z.string().length(26), toVersionId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const versions = await listAssetVersions(ctx.workspaceId, input.assetId);
      const from = versions.find((v) => v.id === input.fromVersionId);
      const to = versions.find((v) => v.id === input.toVersionId);
      if (!from || !to) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found.' });
      return {
        from: from.version,
        to: to.version,
        diff: diffBlocks(from.blocks as AssetBlock[], to.blocks as AssetBlock[]),
      };
    }),

  /** Owner override out of `blocked` — audited. */
  override: ownerProcedure
    .input(
      z.object({
        assetId: z.string().length(26),
        to: z.enum(['draft', 'council', 'revising', 'focus_group', 'deslop', 'compliance', 'packaging', 'approved']),
        reason: z.string().min(3).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await transitionAssetStatus({
          workspaceId: ctx.workspaceId,
          assetId: input.assetId,
          to: input.to,
          override: true,
          actorUserId: ctx.auth.user.id,
          reason: input.reason,
        });
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : 'Transition refused.',
        });
      }
      return { ok: true as const };
    }),
});
