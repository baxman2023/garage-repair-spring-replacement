import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import {
  applySpokenConventions,
  blockDurationSeconds,
  extractJsonObject,
  JOB_TYPES,
  parseExtractedClaims,
  parseGeneratedBlocks,
  timestampBlocks,
  totalDurationSeconds,
  TARGET_LENGTHS,
  type AssetBlock,
} from '@copyforge/core';
import type { createClient } from '@copyforge/ai';
import {
  assets as assetsTable,
  createAsset,
  enqueueJob,
  getPrompt,
  insertAssetVersion,
  insertClaims,
  listAssetVersions,
  tenantDb,
} from '@copyforge/db';
import type { GenerationContext } from './context.js';

/**
 * Paid-traffic entry assets (WO-027): Meta ad sets (5 primary texts + 10
 * headlines + 5 descriptions), YouTube in-stream script (hook ≤5s, 60–90s,
 * spoken conventions), native headline/teaser sets (10), and the full
 * advertorial presell page (story-led, disguised-ad disclosure block). Every
 * ad is angle-tagged and message-match tagged to the VSL lead variant or
 * letter structure it feeds (WO-041 consumes these tags).
 */

export const META_AD_COUNTS = { primary_texts: 5, headlines: 10, descriptions: 5 } as const;
export const NATIVE_PAIR_COUNT = 10;
export const MAX_YT_HOOK_SECONDS = 5.1; // 5s at 170 WPM with rounding headroom
export const YT_MIN_SECONDS = 57; // 60s − 5%
export const YT_MAX_SECONDS = 94.5; // 90s + 5%

/** A lead an ad can message-match: a VSL lead variant or a letter structure. */
export interface LeadTarget {
  assetId: string;
  assetType: 'vsl' | 'sales_letter';
  lead: string;
}

/**
 * Enumerate the market's message-match targets: every persisted VSL lead
 * variant (version meta.leadType) and letter structure (version meta.structure).
 */
export async function listLeadTargets(
  workspaceId: string,
  marketId: string,
): Promise<LeadTarget[]> {
  const rows = await tenantDb(workspaceId).findMany(
    assetsTable,
    and(eq(assetsTable.marketId, marketId), inArray(assetsTable.type, ['vsl', 'sales_letter'])),
  );
  const targets: LeadTarget[] = [];
  for (const asset of rows) {
    const versions = await listAssetVersions(workspaceId, asset.id);
    const leads = new Set<string>();
    for (const v of versions) {
      const meta = (v.meta ?? {}) as { leadType?: string; structure?: string };
      const lead = asset.type === 'vsl' ? meta.leadType : meta.structure;
      if (lead) leads.add(lead);
    }
    for (const lead of leads) {
      targets.push({ assetId: asset.id, assetType: asset.type as 'vsl' | 'sales_letter', lead });
    }
  }
  return targets;
}

const messageMatchSchema = z.object({
  asset_id: z.string().trim().min(1),
  lead: z.string().trim().min(1),
});
type MessageMatch = z.infer<typeof messageMatchSchema>;

function assertKnownTarget(match: MessageMatch, targets: LeadTarget[], label: string): void {
  const known = targets.some((t) => t.assetId === match.asset_id && t.lead === match.lead);
  if (!known) {
    throw new Error(
      `Message-match violation: ${label} targets unknown lead "${match.lead}" on asset "${match.asset_id}".`,
    );
  }
}

function targetsBlock(targets: LeadTarget[]): string {
  return [
    'MESSAGE-MATCH TARGETS (each ad must tag exactly one, by asset_id + lead):',
    ...targets.map((t) => `- asset_id "${t.assetId}" (${t.assetType}) lead "${t.lead}"`),
  ].join('\n');
}

interface AdParams {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
}

async function requireTargets(params: AdParams): Promise<LeadTarget[]> {
  const targets = await listLeadTargets(params.workspaceId, params.context.marketId);
  if (targets.length === 0) {
    throw new Error(
      'Ads must message-match a lead: generate a VSL or sales letter for this market first.',
    );
  }
  return targets;
}

async function draft(params: AdParams, promptName: string, dynamic: string[]): Promise<{ text: string; promptId: string }> {
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
    messages: [{ role: 'user', content: dynamic.join('\n\n') }],
  });
  return { text: result.text, promptId: prompt.id };
}

async function persist(
  params: AdParams,
  type: 'meta_ad' | 'youtube_ad' | 'native_ad' | 'advertorial',
  promptId: string,
  blocks: AssetBlock[],
  versionMeta: Record<string, unknown>,
): Promise<{ assetId: string; versionId: string }> {
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
    meta: versionMeta,
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
  return { assetId, versionId: version.id };
}

// --- Meta ads -----------------------------------------------------------------

const metaAdPieceSchema = z.object({
  text: z.string().trim().min(1),
  angle: z.string().trim().min(1),
  message_match: messageMatchSchema,
});

const metaAdsResultSchema = z.object({
  primary_texts: z.array(metaAdPieceSchema).length(META_AD_COUNTS.primary_texts),
  headlines: z.array(metaAdPieceSchema).length(META_AD_COUNTS.headlines),
  descriptions: z.array(metaAdPieceSchema).length(META_AD_COUNTS.descriptions),
});

export async function generateMetaAds(params: AdParams): Promise<{ assetId: string }> {
  const targets = await requireTargets(params);
  const { text, promptId } = await draft(params, 'generate.meta_ads', [
    targetsBlock(targets),
    `PRODUCT PROFILE:\n${JSON.stringify(params.context.profile, null, 2)}`,
    `APPROVED OFFER:\n${JSON.stringify(params.context.offer, null, 2)}`,
    'Write the Meta ad set as the JSON contract specifies.',
  ]);
  const parsed = metaAdsResultSchema.parse(extractJsonObject(text));

  const blocks: AssetBlock[] = [];
  const push = (pieces: z.infer<typeof metaAdPieceSchema>[], part: string, role: AssetBlock['role'], idPrefix: string) => {
    pieces.forEach((piece, i) => {
      assertKnownTarget(piece.message_match, targets, `${part} ${i + 1}`);
      blocks.push({
        id: `${idPrefix}-${i + 1}`,
        role,
        text: piece.text,
        meta: {
          adPart: part,
          angle: piece.angle,
          messageMatch: { assetId: piece.message_match.asset_id, lead: piece.message_match.lead },
        },
      });
    });
  };
  push(parsed.primary_texts, 'primary_text', 'body', 'primary');
  push(parsed.headlines, 'headline', 'headline', 'headline');
  push(parsed.descriptions, 'description', 'body', 'desc');

  const { assetId } = await persist(params, 'meta_ad', promptId, blocks, {
    counts: META_AD_COUNTS,
    angles: [...new Set(blocks.map((b) => (b.meta as { angle: string }).angle))],
  });
  return { assetId };
}

// --- YouTube in-stream ----------------------------------------------------------

const youtubeResultSchema = z.object({
  blocks: z.array(z.unknown()).min(3),
  angle: z.string().trim().min(1),
  message_match: messageMatchSchema,
});

export async function generateYoutubeAd(params: AdParams): Promise<{ assetId: string }> {
  const targets = await requireTargets(params);
  const { text, promptId } = await draft(params, 'generate.youtube_ad', [
    targetsBlock(targets),
    `PRODUCT PROFILE:\n${JSON.stringify(params.context.profile, null, 2)}`,
    `APPROVED OFFER:\n${JSON.stringify(params.context.offer, null, 2)}`,
    'Write the YouTube in-stream script as the JSON contract specifies.',
  ]);
  const parsed = youtubeResultSchema.parse(extractJsonObject(text));
  assertKnownTarget(parsed.message_match, targets, 'YouTube script');

  const { blocks } = parseGeneratedBlocks({ blocks: parsed.blocks });
  const processed = timestampBlocks(
    blocks.map((b) => ({ ...b, text: applySpokenConventions(b.text) })) as AssetBlock[],
  );

  const first = processed[0]!;
  if (first.role !== 'hook') {
    throw new Error(`YouTube contract violation: the first block must be the hook (got "${first.role}").`);
  }
  const hookSeconds = blockDurationSeconds(first.text);
  if (hookSeconds > MAX_YT_HOOK_SECONDS) {
    throw new Error(
      `YouTube contract violation: hook runs ${hookSeconds.toFixed(1)}s — it must land inside 5 seconds (skip button).`,
    );
  }
  const total = totalDurationSeconds(processed);
  if (total < YT_MIN_SECONDS || total > YT_MAX_SECONDS) {
    throw new Error(
      `YouTube contract violation: script runs ${total.toFixed(1)}s — in-stream scripts must run 60-90 seconds.`,
    );
  }

  const { assetId } = await persist(params, 'youtube_ad', promptId, processed, {
    angle: parsed.angle,
    messageMatch: { assetId: parsed.message_match.asset_id, lead: parsed.message_match.lead },
  });
  return { assetId };
}

// --- Native headline/teaser sets -------------------------------------------------

const nativeResultSchema = z.object({
  pairs: z
    .array(
      z.object({
        headline: z.string().trim().min(1),
        teaser: z.string().trim().min(1),
        angle: z.string().trim().min(1),
        message_match: messageMatchSchema,
      }),
    )
    .length(NATIVE_PAIR_COUNT),
});

export async function generateNativeAds(params: AdParams): Promise<{ assetId: string }> {
  const targets = await requireTargets(params);
  const { text, promptId } = await draft(params, 'generate.native_ads', [
    targetsBlock(targets),
    `PRODUCT PROFILE:\n${JSON.stringify(params.context.profile, null, 2)}`,
    'Write the native ad set as the JSON contract specifies.',
  ]);
  const parsed = nativeResultSchema.parse(extractJsonObject(text));

  const blocks: AssetBlock[] = parsed.pairs.flatMap((pair, i) => {
    assertKnownTarget(pair.message_match, targets, `native pair ${i + 1}`);
    const meta = {
      section: `native_${i + 1}`,
      angle: pair.angle,
      messageMatch: { assetId: pair.message_match.asset_id, lead: pair.message_match.lead },
    };
    return [
      { id: `native-${i + 1}-headline`, role: 'headline' as const, text: pair.headline, meta },
      { id: `native-${i + 1}-teaser`, role: 'body' as const, text: pair.teaser, meta },
    ];
  });

  const { assetId } = await persist(params, 'native_ad', promptId, blocks, {
    pairCount: NATIVE_PAIR_COUNT,
    angles: [...new Set(parsed.pairs.map((p) => p.angle))],
  });
  return { assetId };
}

// --- Advertorial presell ----------------------------------------------------------

const advertorialResultSchema = z.object({
  blocks: z.array(z.unknown()).min(4),
  message_match: messageMatchSchema,
});

/** The disguised-ad disclosure block: present, labeled, and honest. */
export function assertDisclosureBlock(blocks: AssetBlock[]): void {
  const disclosure = blocks.find(
    (b) => (b.meta as { section?: string } | undefined)?.section === 'disclosure',
  );
  if (!disclosure) {
    throw new Error('Advertorial contract violation: no disclosure block (meta.section "disclosure").');
  }
  if (!/advertis|sponsor|paid/i.test(disclosure.text)) {
    throw new Error('Advertorial contract violation: the disclosure block must state the page is an advertisement.');
  }
}

/** Story-led: the first block after the headline(s) must be story. */
export function assertStoryLed(blocks: AssetBlock[]): void {
  const firstContent = blocks.find(
    (b) => b.role !== 'headline' && (b.meta as { section?: string } | undefined)?.section !== 'disclosure',
  );
  if (!firstContent || firstContent.role !== 'story') {
    throw new Error(
      `Advertorial contract violation: the page must be story-led (first content block is "${firstContent?.role ?? 'none'}").`,
    );
  }
}

export async function generateAdvertorial(params: AdParams): Promise<{ assetId: string }> {
  const targets = await requireTargets(params);
  const lengths = TARGET_LENGTHS.advertorial!;
  const { text, promptId } = await draft(params, 'generate.advertorial', [
    targetsBlock(targets),
    `TARGET LENGTH: ${lengths.min}-${lengths.max} words`,
    `PRODUCT PROFILE:\n${JSON.stringify(params.context.profile, null, 2)}`,
    `APPROVED OFFER:\n${JSON.stringify(params.context.offer, null, 2)}`,
    'Write the advertorial presell page as the JSON contract specifies.',
  ]);
  const parsed = advertorialResultSchema.parse(extractJsonObject(text));
  assertKnownTarget(parsed.message_match, targets, 'advertorial');

  const { blocks } = parseGeneratedBlocks({ blocks: parsed.blocks });
  assertDisclosureBlock(blocks as AssetBlock[]);
  assertStoryLed(blocks as AssetBlock[]);

  const { assetId } = await persist(params, 'advertorial', promptId, blocks as AssetBlock[], {
    messageMatch: { assetId: parsed.message_match.asset_id, lead: parsed.message_match.lead },
  });
  return { assetId };
}
