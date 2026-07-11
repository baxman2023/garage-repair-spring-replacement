import { z } from 'zod';
import { extractJsonObject, JOB_TYPES, type AssetBlock } from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  getCurrentAssetVersion,
  insertAssetVersion,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Regenerate a single block (WO-021). Locked blocks refuse regeneration.
 * The new version differs from the current one in exactly the target block.
 */

export const ASSET_REGEN_BLOCK_JOB = JOB_TYPES.assetRegenBlock;

const regenResultSchema = z.object({ text: z.string().trim().min(1) });

export function createRegenBlockHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleRegenBlock(job: ClaimedJob): Promise<void> {
    const assetId = String(job.payload.assetId ?? '');
    const blockId = String(job.payload.blockId ?? '');
    const instruction = String(job.payload.instruction ?? '');
    const projectId = typeof job.payload.projectId === 'string' ? job.payload.projectId : undefined;
    if (!assetId || !blockId) throw new Error('asset.regen_block job missing assetId/blockId');

    const version = await getCurrentAssetVersion(job.workspaceId, assetId);
    if (!version) throw new Error('Asset has no current version.');
    const blocks = version.blocks as AssetBlock[];
    const target = blocks.find((b) => b.id === blockId);
    if (!target) throw new Error(`Block "${blockId}" not found in the current version.`);
    if ((target.meta as { locked?: boolean } | undefined)?.locked) {
      throw new Error(`Block "${blockId}" is locked — unlock it before regenerating.`);
    }

    const draft = blocks.map((b) => `[block ${b.id} · ${b.role}]\n${b.text}`).join('\n\n');
    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'asset_drafting',
      projectId,
      jobId: job.id,
      system: [
        {
          text:
            'You rewrite exactly ONE block of a block-structured direct-response draft. ' +
            'Keep the role and function of the block; improve the text. Preserve any facts; invent nothing. ' +
            'Output ONLY JSON: {"text":"the new block text"}',
          cache: true,
        },
      ],
      messages: [
        {
          role: 'user',
          content: `FULL DRAFT (context):\n\n${draft}\n\nREWRITE BLOCK: ${blockId} (role: ${target.role})${
            instruction ? `\nINSTRUCTION: ${instruction}` : ''
          }`,
        },
      ],
    });

    const { text } = regenResultSchema.parse(extractJsonObject(result.text));
    const nextBlocks = blocks.map((b) => (b.id === blockId ? { ...b, text } : b));
    await insertAssetVersion({
      workspaceId: job.workspaceId,
      assetId,
      blocks: nextBlocks,
      createdBy: 'system',
      meta: { regeneratedBlock: blockId },
    });
  };
}
