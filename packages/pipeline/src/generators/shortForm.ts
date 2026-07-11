import { z } from 'zod';
import {
  applySpokenConventions,
  blockDurationSeconds,
  extractJsonObject,
  JOB_TYPES,
  parseGeneratedBlocks,
  timestampBlocks,
  wordCount,
  type AssetBlock,
} from '@copyforge/core';
import type { createClient } from '@copyforge/ai';
import {
  createAsset,
  enqueueJob,
  getAsset,
  getPrompt,
  insertAssetVersion,
} from '@copyforge/db';
import type { GenerationContext } from './context.js';

/**
 * Short-form feeder hooks (WO-024): three ~30-second vertical scripts per
 * market feeding the VSL. Hook ≤3 seconds and FIRST; ≤90 spoken words each;
 * curiosity CTA carries the parent VSL's slug; same spoken post-processor;
 * assets linked to the parent VSL variant.
 */

export const MAX_FEEDER_WORDS = 90;
export const MAX_HOOK_SECONDS = 3.1; // 3s at 170 WPM with rounding headroom

const shortFormResultSchema = z.object({
  scripts: z
    .array(
      z.object({
        blocks: z.array(z.unknown()).min(2),
      }),
    )
    .length(3),
});

export async function generateShortForm(params: {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
  /** Parent VSL asset id (defaults to the market's newest VSL). */
  parentVslId?: string;
}): Promise<{ assetIds: string[] }> {
  const { context } = params;
  const prompt = await getPrompt('generate.short_form');
  if (!prompt) throw new Error('No active prompt "generate.short_form" — run the seed.');

  // Resolve the parent VSL (feeders exist to feed it).
  let vslId = params.parentVslId ?? '';
  if (!vslId) {
    const { assets: assetsTable, tenantDb } = await import('@copyforge/db');
    const { and, eq } = await import('drizzle-orm');
    const rows = await tenantDb(params.workspaceId).findMany(
      assetsTable,
      and(eq(assetsTable.marketId, context.marketId), eq(assetsTable.type, 'vsl')),
    );
    const newest = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!newest) throw new Error('Short-form feeders need a VSL for this market first.');
    vslId = newest.id;
  }
  const vsl = await getAsset(params.workspaceId, vslId);
  if (!vsl || vsl.type !== 'vsl') throw new Error('Parent VSL not found.');
  const slug = vsl.slug ?? `vsl-${vsl.id.slice(-8).toLowerCase()}`;

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
          `PARENT VSL SLUG: ${slug}`,
          `PRODUCT PROFILE:\n${JSON.stringify(context.profile, null, 2)}`,
          'Write the three feeder scripts as the JSON contract specifies.',
        ].join('\n\n'),
      },
    ],
  });

  const parsed = shortFormResultSchema.parse(extractJsonObject(result.text));
  const assetIds: string[] = [];

  for (const script of parsed.scripts) {
    const { blocks } = parseGeneratedBlocks({ blocks: script.blocks });
    const processed = timestampBlocks(
      blocks.map((b) => ({ ...b, text: applySpokenConventions(b.text) })) as AssetBlock[],
    );

    // Hook: flagged, first, ≤3 seconds.
    const first = processed[0]!;
    if (first.role !== 'hook') {
      throw new Error(`Feeder contract violation: the first block must be the hook (got "${first.role}").`);
    }
    const hookSeconds = blockDurationSeconds(first.text);
    if (hookSeconds > MAX_HOOK_SECONDS) {
      throw new Error(
        `Feeder contract violation: hook runs ${hookSeconds.toFixed(1)}s — the pattern interrupt must land inside 3 seconds.`,
      );
    }

    // ≤ 90 spoken words total.
    const totalWords = wordCount(processed.map((b) => b.text).join(' '));
    if (totalWords > MAX_FEEDER_WORDS) {
      throw new Error(`Feeder contract violation: ${totalWords} words — feeders must stay ≤ ${MAX_FEEDER_WORDS}.`);
    }

    // CTA must reference the parent VSL slug.
    const cta = processed.find((b) => b.role === 'cta');
    if (!cta) throw new Error('Feeder contract violation: no CTA block.');
    const ctaTarget = (cta.meta as { ctaTarget?: string } | undefined)?.ctaTarget;
    if (ctaTarget !== slug) {
      throw new Error(
        `Feeder contract violation: CTA must reference the parent VSL slug "${slug}" via meta.ctaTarget (got "${ctaTarget ?? 'none'}").`,
      );
    }

    const assetId = await createAsset({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      marketId: context.marketId,
      type: 'short_form_video',
      promptVersionId: prompt.id,
      parentAssetId: vslId, // linked to the parent VSL variant
    });
    await insertAssetVersion({
      workspaceId: params.workspaceId,
      assetId,
      blocks: processed,
      createdBy: 'system',
      promptVersionId: prompt.id,
      meta: { parentVslSlug: slug },
    });
    await enqueueJob({
      workspaceId: params.workspaceId,
      type: JOB_TYPES.assetCouncil,
      payload: { projectId: params.projectId, assetId, marketId: context.marketId },
    });
    assetIds.push(assetId);
  }

  return { assetIds };
}
