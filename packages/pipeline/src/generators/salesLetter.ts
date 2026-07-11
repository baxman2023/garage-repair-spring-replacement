import {
  extractJsonObject,
  parseExtractedClaims,
  parseGeneratedBlocks,
  TARGET_LENGTHS,
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
import { JOB_TYPES } from '@copyforge/core';
import type { GenerationContext } from './context.js';

/**
 * Long-form sales letter generator (WO-022). Structure selector
 * (PAS | star-story-solution | 4Ps — defaulted by awareness stage), Bencivenga
 * bullet engine fed by VOC + proof, mechanism section on the profile's
 * mechanism names, offer/close from the approved offer. Consumes the market +
 * genome cache blocks; registers every claim; enters G3 automatically.
 */

export const LETTER_STRUCTURES = ['pas', 'star_story_solution', '4ps'] as const;
export type LetterStructure = (typeof LETTER_STRUCTURES)[number];

/** Default structure by awareness stage (overridable per run). */
export function defaultStructure(awareness: string): LetterStructure {
  switch (awareness) {
    case 'unaware':
    case 'problem':
      return 'pas';
    case 'solution':
      return 'star_story_solution';
    default:
      return '4ps';
  }
}

export async function generateSalesLetter(params: {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
  structure?: LetterStructure;
}): Promise<{ assetId: string; versionId: string }> {
  const { context } = params;
  const prompt = await getPrompt('generate.sales_letter');
  if (!prompt) throw new Error('No active prompt "generate.sales_letter" — run the seed.');
  const claimsPrompt = await getPrompt('claims.extract');
  if (!claimsPrompt) throw new Error('No active prompt "claims.extract" — run the seed.');

  const structure = params.structure ?? defaultStructure(context.market.awareness_stage);
  const lengths = TARGET_LENGTHS.sales_letter!;

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
          `STRUCTURE: ${structure}`,
          `TARGET LENGTH: ${lengths.min}-${lengths.max} words`,
          `PRODUCT PROFILE:\n${JSON.stringify(context.profile, null, 2)}`,
          `APPROVED OFFER:\n${JSON.stringify(context.offer, null, 2)}`,
          'Write the complete letter as the blocks JSON contract specifies.',
        ].join('\n\n'),
      },
    ],
  });

  const { blocks } = parseGeneratedBlocks(extractJsonObject(result.text));

  const assetId = await createAsset({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    marketId: context.marketId,
    type: 'sales_letter',
    promptVersionId: prompt.id, // pinned (WO-008)
  });
  const version = await insertAssetVersion({
    workspaceId: params.workspaceId,
    assetId,
    blocks: blocks as AssetBlock[],
    createdBy: 'system',
    promptVersionId: prompt.id,
    meta: { structure },
  });

  // Register every claim (WO-022 acceptance) via the haiku extraction stage.
  const fullText = blocks.map((b) => b.text).join('\n\n');
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

  // Enter G3 automatically.
  await enqueueJob({
    workspaceId: params.workspaceId,
    type: JOB_TYPES.assetCouncil,
    payload: { projectId: params.projectId, assetId, marketId: context.marketId },
  });

  return { assetId, versionId: version.id };
}
