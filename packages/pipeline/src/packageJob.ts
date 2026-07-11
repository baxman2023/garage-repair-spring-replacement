import { and, eq, inArray } from 'drizzle-orm';
import {
  checkG7,
  composePageBuildPackage,
  JOB_TYPES,
  packageChecksum,
  parseMarketProfile,
  type AssetBlock,
  type PackageUtmVariant,
} from '@copyforge/core';
import {
  assets as assetsTable,
  getAsset,
  getCurrentAssetVersion,
  getCurrentProfile,
  latestPackage,
  listAssetVersions,
  listMarkets,
  quizDefinitions,
  recordAssetGate,
  savePackage,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Page Build Package composer job — gate G7 (WO-035). Fully deterministic
 * (no AI): gathers the asset's current blocks, the market profile, the
 * message-match variant map (from WO-027 ad↔lead tags), and the project's
 * quiz ref, composes the §4 package, persists it with a content checksum
 * (stable across identical inputs), and records G7 — which BLOCKS while any
 * rendering (files / Macaly prompt / universal prompt) is missing.
 */

export const ASSET_PACKAGE_JOB = JOB_TYPES.assetPackage;

/** Package variant + the texts the runtime swap needs (WO-041 map seeding). */
export type CollectedUtmVariant = PackageUtmVariant & {
  headline_text: string;
  lead_text: string;
};

/**
 * Derive the utm variant map from ads whose blocks message-match this asset
 * (WO-027 tags): each tagged ad piece names the lead variant it feeds.
 */
export async function collectUtmVariants(
  workspaceId: string,
  marketId: string,
  targetAssetId: string,
): Promise<CollectedUtmVariant[]> {
  const adAssets = await tenantDb(workspaceId).findMany(
    assetsTable,
    and(
      eq(assetsTable.marketId, marketId),
      inArray(assetsTable.type, ['meta_ad', 'youtube_ad', 'native_ad', 'advertorial']),
    ),
  );
  const target = await getAsset(workspaceId, targetAssetId);
  if (!target) return [];
  const versions = await listAssetVersions(workspaceId, targetAssetId);

  /** headline/lead blocks for a given lead variant of the target asset. */
  const variantBlocks = (
    lead: string,
  ): { headline: AssetBlock; lead: AssetBlock } | null => {
    const version =
      versions.find((v) => {
        const meta = (v.meta ?? {}) as { leadType?: string; structure?: string };
        return meta.leadType === lead || meta.structure === lead;
      }) ?? versions[versions.length - 1];
    if (!version) return null;
    const blocks = version.blocks as AssetBlock[];
    const headline = blocks.find((b) => b.role === 'headline' || b.role === 'hook');
    const leadBlock = blocks.find((b) => b.role === 'lead') ?? blocks[1] ?? blocks[0];
    if (!headline || !leadBlock) return null;
    return { headline, lead: leadBlock };
  };

  const variants: CollectedUtmVariant[] = [];
  for (const ad of adAssets) {
    const version = await getCurrentAssetVersion(workspaceId, ad.id);
    if (!version) continue;
    const versionMatch = (version.meta as { messageMatch?: { assetId: string; lead: string }; angle?: string } | null) ?? {};
    const candidates: Array<{ blockId: string; angle: string; lead: string }> = [];
    for (const block of version.blocks as AssetBlock[]) {
      const meta = block.meta as
        | { messageMatch?: { assetId: string; lead: string }; angle?: string }
        | undefined;
      if (meta?.messageMatch?.assetId === targetAssetId) {
        candidates.push({ blockId: block.id, angle: meta.angle ?? 'unspecified', lead: meta.messageMatch.lead });
      }
    }
    // Whole-asset match (YouTube script / advertorial tag on version meta).
    if (candidates.length === 0 && versionMatch.messageMatch?.assetId === targetAssetId) {
      candidates.push({
        blockId: 'script',
        angle: versionMatch.angle ?? 'unspecified',
        lead: versionMatch.messageMatch.lead,
      });
    }
    for (const c of candidates) {
      const blocks = variantBlocks(c.lead);
      if (!blocks) continue;
      variants.push({
        utm_content: `${ad.type}:${c.blockId}`,
        angle: c.angle,
        headline_block: blocks.headline.id,
        lead_block: blocks.lead.id,
        source: ad.id,
        headline_text: blocks.headline.text,
        lead_text: blocks.lead.text,
      });
    }
  }
  return variants.sort((a, b) => a.utm_content.localeCompare(b.utm_content));
}

export function createPackageHandler() {
  return async function handlePackage(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const assetId = String(job.payload.assetId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    if (!projectId || !assetId || !marketId) {
      throw new Error('asset.package job missing projectId/assetId/marketId');
    }

    const asset = await getAsset(job.workspaceId, assetId);
    if (!asset) throw new Error('Asset not found.');
    const version = await getCurrentAssetVersion(job.workspaceId, assetId);
    if (!version) throw new Error('Asset has no current version to package.');

    const markets = await listMarkets(job.workspaceId, projectId);
    const market = markets.find((m) => m.id === marketId);
    if (!market) throw new Error('Market not found for packaging.');
    const profile = parseMarketProfile(market.profile);

    const productProfile = await getCurrentProfile(job.workspaceId, projectId);
    const title =
      ((productProfile?.profile as { name?: string } | null)?.name ?? '').trim() || asset.type;

    const quizzes = await tenantDb(job.workspaceId).findMany(
      quizDefinitions,
      eq(quizDefinitions.projectId, projectId),
    );
    const quizSnippetRef = quizzes[0]?.slug ?? null;

    const utmVariants = await collectUtmVariants(job.workspaceId, marketId, assetId);

    // Auto-seed the runtime variant maps (WO-041) from the same ad↔lead tags.
    const { seedUtmVariantMaps } = await import('@copyforge/db');
    await seedUtmVariantMaps({
      workspaceId: job.workspaceId,
      projectId,
      assetId,
      variants: utmVariants.map((v) => ({
        utmContent: v.utm_content,
        headlineBlock: v.headline_block,
        headlineText: v.headline_text,
        leadBlock: v.lead_block,
        leadText: v.lead_text,
        angle: v.angle,
        sourceAdAssetId: v.source,
      })),
    });

    // Preserve renderings already produced for this asset (checksum excludes them).
    const previous = await latestPackage(job.workspaceId, assetId);
    const previousRenderings = (previous?.package as { renderings?: { file_paths: string[]; macaly_prompt: string; universal_llm_prompt: string } } | null)?.renderings;

    const pkg = composePageBuildPackage({
      scope: { project: projectId, market: marketId, asset: assetId, assetType: asset.type },
      blocks: version.blocks as AssetBlock[],
      profile,
      title,
      utmVariants,
      quizSnippetRef,
      renderings: previousRenderings,
    });
    const checksum = packageChecksum(pkg);

    await savePackage({
      workspaceId: job.workspaceId,
      projectId,
      marketId,
      assetId,
      pkg,
      checksum,
    });

    // Render the file artifacts (WO-036) — fills renderings.file_paths.
    const { exportAssetFiles } = await import('./exporter.js');
    const { packageId, files } = await exportAssetFiles({ workspaceId: job.workspaceId, assetId });
    pkg.renderings.file_paths = files.map((f) => f.path);

    // Compile the build prompts (WO-037/038) from the registry templates.
    const { compileMacalyPrompt, joinPromptParts, compileUniversalPrompt } = await import('@copyforge/core');
    const { getPrompt, updatePackageRenderings } = await import('@copyforge/db');
    const macalyTemplate = await getPrompt('macaly.build');
    if (macalyTemplate) {
      const compiled = compileMacalyPrompt(pkg, macalyTemplate.body);
      pkg.renderings.macaly_prompt = joinPromptParts(compiled.prompts);
    }
    const universalTemplate = await getPrompt('universal.build');
    if (universalTemplate) {
      pkg.renderings.universal_llm_prompt = compileUniversalPrompt(pkg, universalTemplate.body, 'single-html');
    }
    await updatePackageRenderings({
      workspaceId: job.workspaceId,
      packageId,
      renderings: pkg.renderings,
    });

    const g7 = checkG7(pkg);
    await recordAssetGate({
      workspaceId: job.workspaceId,
      assetId,
      gate: 'G7',
      pass: g7.pass,
      report: {
        checksum,
        missing: g7.missing,
        copyBlocks: pkg.copy_blocks.length,
        utmVariants: pkg.message_match.utm_variants.length,
        hasVideoObject: pkg.media.videoobject_schema !== null,
        quizEmbed: pkg.quiz_embed?.snippet_ref ?? null,
      },
    });
    // The asset stays in `packaging`; owner approval (WO-033) is the human step.
  };
}
