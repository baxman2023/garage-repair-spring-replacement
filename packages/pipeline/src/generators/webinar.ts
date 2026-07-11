import { z } from 'zod';
import {
  applySpokenConventions,
  extractJsonObject,
  generatedBlockSchema,
  integerToWords,
  JOB_TYPES,
  parseExtractedClaims,
  parseGeneratedBlocks,
  timestampBlocks,
  TARGET_LENGTHS,
  type AssetBlock,
  type Offer,
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
 * Webinar generator (WO-025): Perfect-Webinar skeleton — big domino, three
 * secrets breaking the vehicle/internal/external beliefs, stack & close from
 * the approved offer — plus registration-page copy, reminder emails
 * (24h/1h/15m), and the replay email. Presentation blocks are spoken-processed
 * and 170-WPM timestamped; the stack must mirror the offer line-for-line.
 */

export const WEBINAR_SECTIONS = [
  'big_domino',
  'secret_vehicle',
  'secret_internal',
  'secret_external',
  'stack',
  'close',
] as const;
export type WebinarSection = (typeof WEBINAR_SECTIONS)[number];

const EMAIL_KINDS = ['reminder_24h', 'reminder_1h', 'reminder_15m', 'replay'] as const;

const webinarResultSchema = z.object({
  presentation: z.object({ blocks: z.array(z.unknown()).min(6) }),
  // parseGeneratedBlocks demands ≥3 blocks; a registration page is valid at 2,
  // so its blocks are validated against the block contract directly.
  registration: z.object({ blocks: z.array(generatedBlockSchema).min(2) }),
  emails: z
    .array(
      z.object({
        kind: z.enum(EMAIL_KINDS),
        subject: z.string().trim().min(1),
        body: z.string().trim().min(1),
      }),
    )
    .length(4),
});

/** Sections must all be present and in skeleton order (WO-025 acceptance). */
export function assertSkeletonOrder(blocks: AssetBlock[]): void {
  const positions = WEBINAR_SECTIONS.map((section) => ({
    section,
    index: blocks.findIndex((b) => (b.meta as { section?: string } | undefined)?.section === section),
  }));
  for (const p of positions) {
    if (p.index === -1) throw new Error(`Webinar skeleton violation: missing section "${p.section}".`);
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i]!.index <= positions[i - 1]!.index) {
      throw new Error(
        `Webinar skeleton violation: "${positions[i]!.section}" must come after "${positions[i - 1]!.section}".`,
      );
    }
  }
}

/** The stack block must mirror the offer's value stack line-for-line. */
export function assertStackMirrorsOffer(blocks: AssetBlock[], offer: Offer): void {
  const stack = blocks.find((b) => (b.meta as { section?: string } | undefined)?.section === 'stack');
  if (!stack) throw new Error('Webinar skeleton violation: missing section "stack".');
  const text = stack.text.toLowerCase();
  for (const item of offer.value_stack) {
    if (!text.includes(item.item.toLowerCase())) {
      throw new Error(`Stack violation: value-stack item "${item.item}" is missing from the stack section.`);
    }
    // Spoken conventions have converted $ values to words by now.
    const spokenValue = integerToWords(Math.round(item.value_usd));
    if (!text.includes(spokenValue)) {
      throw new Error(
        `Stack violation: item "${item.item}" must carry its value (${spokenValue} dollars) line-for-line.`,
      );
    }
  }
}

export async function generateWebinar(params: {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
}): Promise<{ assetId: string; versionId: string }> {
  const { context } = params;
  const prompt = await getPrompt('generate.webinar');
  if (!prompt) throw new Error('No active prompt "generate.webinar" — run the seed.');
  const claimsPrompt = await getPrompt('claims.extract');
  if (!claimsPrompt) throw new Error('No active prompt "claims.extract" — run the seed.');

  const lengths = TARGET_LENGTHS.webinar!;
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
          `TARGET LENGTH for the presentation: ${lengths.min}-${lengths.max} words at one hundred seventy words per minute`,
          `PRODUCT PROFILE:\n${JSON.stringify(context.profile, null, 2)}`,
          `APPROVED OFFER:\n${JSON.stringify(context.offer, null, 2)}`,
          'Write the full webinar package as the JSON contract specifies.',
        ].join('\n\n'),
      },
    ],
  });

  const parsed = webinarResultSchema.parse(extractJsonObject(result.text));

  // Presentation: spoken conventions + timestamps, then skeleton assertions.
  const presentation = parseGeneratedBlocks({ blocks: parsed.presentation.blocks });
  const spoken = timestampBlocks(
    presentation.blocks.map((b) => ({ ...b, text: applySpokenConventions(b.text) })) as AssetBlock[],
  );
  assertSkeletonOrder(spoken);
  assertStackMirrorsOffer(spoken, context.offer);

  // Registration page (written copy — no spoken processing).
  const registration = parsed.registration.blocks.map((b) => ({
    ...b,
    meta: { ...b.meta, section: 'registration' },
  }));

  // Emails: subject + body block per message.
  const emailBlocks: AssetBlock[] = parsed.emails.flatMap((email) => [
    {
      id: `${email.kind}-subject`,
      role: 'subject',
      text: email.subject,
      meta: { section: `email_${email.kind}` },
    },
    {
      id: `${email.kind}-body`,
      role: 'body',
      text: email.body,
      meta: { section: `email_${email.kind}` },
    },
  ]);

  const allBlocks = [...spoken, ...(registration as AssetBlock[]), ...emailBlocks];

  const assetId = await createAsset({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    marketId: context.marketId,
    type: 'webinar',
    promptVersionId: prompt.id,
  });
  const version = await insertAssetVersion({
    workspaceId: params.workspaceId,
    assetId,
    blocks: allBlocks,
    createdBy: 'system',
    promptVersionId: prompt.id,
    meta: { sections: WEBINAR_SECTIONS, emails: parsed.emails.map((e) => e.kind) },
  });

  const fullText = allBlocks.map((b) => b.text).join('\n\n');
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

  await enqueueJob({
    workspaceId: params.workspaceId,
    type: JOB_TYPES.assetCouncil,
    payload: { projectId: params.projectId, assetId, marketId: context.marketId },
  });

  return { assetId, versionId: version.id };
}
