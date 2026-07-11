import { z } from 'zod';
import {
  applySpokenConventions,
  extractJsonObject,
  JOB_TYPES,
  parseExtractedClaims,
  parseGeneratedBlocks,
  timestampBlocks,
  TARGET_LENGTHS,
  type AssetBlock,
} from '@copyforge/core';
import type { createClient } from '@copyforge/ai';
import { eq } from 'drizzle-orm';
import {
  assets as assetsTable,
  createAsset,
  enqueueJob,
  getPrompt,
  insertAssetVersion,
  insertClaims,
  tenantDb,
} from '@copyforge/db';
import type { GenerationContext } from './context.js';

/**
 * VSL generator (WO-023): RMBC construction, THREE lead variants
 * (story | big_promise | secret) persisted as sibling versions, 170-WPM
 * timestamps, retention map with open-loop blocks planted before predicted
 * drop-offs, promise verbalized inside the first thirty seconds (asserted),
 * spoken conventions enforced by the post-processor.
 */

export const VSL_LEAD_TYPES = ['story', 'big_promise', 'secret'] as const;
export type VslLeadType = (typeof VSL_LEAD_TYPES)[number];

const vslResultSchema = z.object({
  variants: z
    .array(
      z.object({
        lead_type: z.enum(VSL_LEAD_TYPES),
        blocks: z.array(z.unknown()).min(3),
        retention_map: z
          .array(
            z.object({
              drop_after_block: z.string().min(1),
              reason: z.string().min(1),
              open_loop_block: z.string().min(1),
            }),
          )
          .min(1),
      }),
    )
    .length(3),
});

/** First-30-seconds promise assertion (WO-023). */
export function assertPromiseInFirst30Seconds(blocks: AssetBlock[]): void {
  const promiseBlock = blocks.find(
    (b) => (b.meta as { verbalizesPromise?: boolean } | undefined)?.verbalizesPromise,
  );
  if (!promiseBlock) {
    throw new Error('VSL contract violation: no block flagged verbalizesPromise.');
  }
  const start = (promiseBlock.meta as { timestampStart?: number }).timestampStart ?? Infinity;
  if (start >= 30) {
    throw new Error(
      `VSL contract violation: the promise lands at ${start.toFixed(1)}s — it must be verbalized inside the first 30 seconds.`,
    );
  }
}

export async function generateVsl(params: {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
}): Promise<{ assetId: string; versionIds: string[] }> {
  const { context } = params;
  const prompt = await getPrompt('generate.vsl');
  if (!prompt) throw new Error('No active prompt "generate.vsl" — run the seed.');
  const claimsPrompt = await getPrompt('claims.extract');
  if (!claimsPrompt) throw new Error('No active prompt "claims.extract" — run the seed.');

  const lengths = TARGET_LENGTHS.vsl!;
  const result = await params.ai.generate({
    workspaceId: params.workspaceId,
    stage: 'asset_drafting',
    projectId: params.projectId,
    jobId: params.jobId,
    system: [
      { text: context.genomeBlock, cache: true },
      { text: `${context.marketBlock}\n\n${context.vocBlock}`, cache: true },
      { text: prompt.body, cache: true },
    ],
    messages: [
      {
        role: 'user',
        content: [
          `TARGET LENGTH per variant: ${lengths.min}-${lengths.max} words (eight to twenty minutes at one hundred seventy words per minute)`,
          `PRODUCT PROFILE:\n${JSON.stringify(context.profile, null, 2)}`,
          `APPROVED OFFER:\n${JSON.stringify(context.offer, null, 2)}`,
          'Write all three lead variants as the JSON contract specifies.',
        ].join('\n\n'),
      },
    ],
  });

  const parsed = vslResultSchema.parse(extractJsonObject(result.text));

  const assetId = await createAsset({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    marketId: context.marketId,
    type: 'vsl',
    promptVersionId: prompt.id,
  });
  // Slug: the deployable identity feeder hooks and message-match reference.
  const slug = `vsl-${assetId.slice(-8).toLowerCase()}`;
  await tenantDb(params.workspaceId).update(assetsTable, { slug }, eq(assetsTable.id, assetId));

  const versionIds: string[] = [];
  for (const variant of parsed.variants) {
    // Contract-parse the raw blocks, then enforce spoken conventions + stamps.
    const { blocks } = parseGeneratedBlocks({ blocks: variant.blocks });
    const openLoopIds = new Set(variant.retention_map.map((r) => r.open_loop_block));
    const dropAfter = new Map(variant.retention_map.map((r) => [r.drop_after_block, r.reason]));

    const processed = timestampBlocks(
      blocks.map((b) => ({
        ...b,
        text: applySpokenConventions(b.text),
        meta: {
          ...b.meta,
          ...(openLoopIds.has(b.id) ? { openLoop: true } : {}),
          ...(dropAfter.has(b.id) ? { predictedDropAfter: dropAfter.get(b.id) } : {}),
        },
      })) as AssetBlock[],
    );

    // Retention-map sanity: each open-loop block must sit immediately before
    // its predicted drop-off point.
    for (const entry of variant.retention_map) {
      const dropIndex = processed.findIndex((b) => b.id === entry.drop_after_block);
      const loopIndex = processed.findIndex((b) => b.id === entry.open_loop_block);
      if (dropIndex === -1 || loopIndex === -1) {
        throw new Error(`Retention map references unknown block ids (${entry.drop_after_block} / ${entry.open_loop_block}).`);
      }
      if (loopIndex > dropIndex) {
        throw new Error(
          `Retention map violation: open loop "${entry.open_loop_block}" must be planted at or before the predicted drop after "${entry.drop_after_block}".`,
        );
      }
    }

    assertPromiseInFirst30Seconds(processed);

    const version = await insertAssetVersion({
      workspaceId: params.workspaceId,
      assetId,
      blocks: processed,
      createdBy: 'system',
      promptVersionId: prompt.id,
      meta: { leadType: variant.lead_type, retentionMap: variant.retention_map },
    });
    versionIds.push(version.id);

    const fullText = processed.map((b) => b.text).join('\n\n');
    const claimsResult = await params.ai.generate({
      workspaceId: params.workspaceId,
      stage: 'claims_extraction',
      projectId: params.projectId,
      jobId: params.jobId,
      system: [{ text: claimsPrompt.body, cache: true }],
      messages: [
        {
          role: 'user',
          content: `KNOWN PROOF ASSETS:\n${JSON.stringify(context.profile.proof_assets)}\n\nCOPY:\n\n${fullText}`,
        },
      ],
    });
    const { claims } = parseExtractedClaims(extractJsonObject(claimsResult.text));
    await insertClaims({
      workspaceId: params.workspaceId,
      assetId,
      assetVersionId: version.id,
      claims: claims.map((c) => ({ text: c.text, proofRef: c.proof_ref || undefined })),
    });
  }

  await enqueueJob({
    workspaceId: params.workspaceId,
    type: JOB_TYPES.assetCouncil,
    payload: { projectId: params.projectId, assetId, marketId: context.marketId },
  });

  return { assetId, versionIds };
}
