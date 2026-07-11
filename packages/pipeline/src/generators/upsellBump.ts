import { z } from 'zod';
import {
  extractJsonObject,
  JOB_TYPES,
  parseExtractedClaims,
  parseGeneratedBlocks,
  wordCount,
  type AssetBlock,
} from '@copyforge/core';
import type { createClient } from '@copyforge/ai';
import {
  createAsset,
  enqueueJob,
  getPrompt,
  insertAssetVersion,
  insertClaims,
} from '@copyforge/db';
import type { GenerationContext } from './context.js';

/**
 * Upsell + order-bump copy (WO-028, appended to every market chain). The
 * upsell is the post-purchase one-decision page (accept/decline); the order
 * bump is the short checkout checkbox pitch. Both written copy, both built
 * from the approved offer only — no new promises the offer never made.
 */

export const MAX_BUMP_WORDS = 150;

const upsellResultSchema = z.object({ blocks: z.array(z.unknown()).min(3) });

const bumpResultSchema = z.object({
  headline: z.string().trim().min(1),
  body: z.string().trim().min(1),
  checkbox_line: z.string().trim().min(1),
});

interface GenParams {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
}

async function persist(
  params: GenParams,
  type: 'upsell' | 'order_bump',
  promptId: string,
  blocks: AssetBlock[],
): Promise<{ assetId: string }> {
  const assetId = await createAsset({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    marketId: params.context.marketId,
    type,
    promptVersionId: promptId,
  });
  const version = await insertAssetVersion({
    workspaceId: params.workspaceId,
    assetId,
    blocks,
    createdBy: 'system',
    promptVersionId: promptId,
  });

  const claimsPrompt = await getPrompt('claims.extract');
  if (!claimsPrompt) throw new Error('No active prompt "claims.extract" — run the seed.');
  const claimsResult = await params.ai.generate({
    workspaceId: params.workspaceId,
    stage: 'claims_extraction',
    projectId: params.projectId,
    jobId: params.jobId,
    system: [{ text: claimsPrompt.body, cache: true }],
    messages: [
      {
        role: 'user',
        content: `KNOWN PROOF ASSETS:\n${JSON.stringify(params.context.profile.proof_assets)}\n\nCOPY:\n\n${blocks.map((b) => b.text).join('\n\n')}`,
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

  await enqueueJob({
    workspaceId: params.workspaceId,
    type: JOB_TYPES.assetCouncil,
    payload: { projectId: params.projectId, assetId, marketId: params.context.marketId },
  });
  return { assetId };
}

async function draft(params: GenParams, promptName: string, instruction: string) {
  const prompt = await getPrompt(promptName);
  if (!prompt) throw new Error(`No active prompt "${promptName}" — run the seed.`);
  const result = await params.ai.generate({
    workspaceId: params.workspaceId,
    stage: 'asset_drafting',
    projectId: params.projectId,
    jobId: params.jobId,
    system: [
      { text: params.context.genomeBlock, cache: true },
      { text: `${params.context.marketBlock}\n\n${params.context.vocBlock}`, cache: true },
      { text: prompt.body, cache: true },
    ],
    messages: [
      {
        role: 'user',
        content: [
          `PRODUCT PROFILE:\n${JSON.stringify(params.context.profile, null, 2)}`,
          `APPROVED OFFER:\n${JSON.stringify(params.context.offer, null, 2)}`,
          instruction,
        ].join('\n\n'),
      },
    ],
  });
  return { text: result.text, promptId: prompt.id };
}

export async function generateUpsell(params: GenParams): Promise<{ assetId: string }> {
  const { text, promptId } = await draft(
    params,
    'generate.upsell',
    'Write the post-purchase upsell page as the JSON contract specifies.',
  );
  const parsed = upsellResultSchema.parse(extractJsonObject(text));
  const { blocks } = parseGeneratedBlocks({ blocks: parsed.blocks });

  // One decision: exactly one accept CTA, and an honest decline path.
  const ctas = blocks.filter((b) => b.role === 'cta');
  if (ctas.length !== 1) {
    throw new Error(`Upsell contract violation: exactly one accept CTA required (got ${ctas.length}).`);
  }
  const decline = blocks.find(
    (b) => (b.meta as { section?: string } | undefined)?.section === 'decline',
  );
  if (!decline) {
    throw new Error('Upsell contract violation: a decline block (meta.section "decline") is required.');
  }

  return persist(params, 'upsell', promptId, blocks as AssetBlock[]);
}

export async function generateOrderBump(params: GenParams): Promise<{ assetId: string }> {
  const { text, promptId } = await draft(
    params,
    'generate.order_bump',
    'Write the checkout order-bump copy as the JSON contract specifies.',
  );
  const parsed = bumpResultSchema.parse(extractJsonObject(text));

  const total = wordCount(`${parsed.headline} ${parsed.body} ${parsed.checkbox_line}`);
  if (total > MAX_BUMP_WORDS) {
    throw new Error(
      `Order-bump contract violation: ${total} words — checkout bumps must stay ≤ ${MAX_BUMP_WORDS}.`,
    );
  }

  const blocks: AssetBlock[] = [
    { id: 'bump-headline', role: 'headline', text: parsed.headline },
    { id: 'bump-body', role: 'body', text: parsed.body },
    { id: 'bump-checkbox', role: 'cta', text: parsed.checkbox_line, meta: { section: 'checkbox' } },
  ];
  return persist(params, 'order_bump', promptId, blocks);
}
