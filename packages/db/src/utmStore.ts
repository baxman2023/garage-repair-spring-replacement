import { and, eq } from 'drizzle-orm';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { recordEvent } from './eventsStore.js';
import { utmVariantMaps } from './schema/index.js';

/**
 * Message-match variant maps (WO-041): utm_content → the headline+lead
 * variant of the target page asset. Auto-seeded from WO-027's ad↔lead tags
 * during packaging; the public middleware resolves by (assetId, utm_content).
 */

export type UtmVariantMapRow = typeof utmVariantMaps.$inferSelect;

export interface UtmVariantSeed {
  utmContent: string;
  utmCampaign?: string | null;
  headlineBlock: string;
  headlineText: string;
  leadBlock: string;
  leadText: string;
  angle: string;
  /** The ad asset the utm_content identifies. */
  sourceAdAssetId: string;
}

/** Replace the target asset's variant map (idempotent re-seed on repackage). */
export async function seedUtmVariantMaps(params: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  variants: UtmVariantSeed[];
}): Promise<number> {
  const db = tenantDb(params.workspaceId);
  const existing = await db.findMany(utmVariantMaps, eq(utmVariantMaps.assetId, params.assetId));
  for (const row of existing) {
    await db.delete(utmVariantMaps, eq(utmVariantMaps.id, row.id));
  }
  for (const v of params.variants) {
    await db.insert(utmVariantMaps, {
      projectId: params.projectId,
      assetId: params.assetId,
      utmContent: v.utmContent,
      utmCampaign: v.utmCampaign ?? null,
      headlineVariant: { block: v.headlineBlock, text: v.headlineText, angle: v.angle },
      leadVariant: { block: v.leadBlock, text: v.leadText },
      variantOfAssetId: v.sourceAdAssetId,
    });
  }
  return params.variants.length;
}

/**
 * PUBLIC runtime lookup (the middleware path): by unguessable asset id +
 * utm_content. Returns null for unmapped — the snippet falls back to control.
 */
export async function lookupUtmVariant(
  assetId: string,
  utmContent: string,
): Promise<{ headline: string | null; lead: string | null } | null> {
  const rows = await getDb()
    .select()
    .from(utmVariantMaps)
    .where(and(eq(utmVariantMaps.assetId, assetId), eq(utmVariantMaps.utmContent, utmContent)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    headline: (row.headlineVariant as { text?: string } | null)?.text ?? null,
    lead: (row.leadVariant as { text?: string } | null)?.text ?? null,
  };
}

/** Resolve the owning workspace for impression logging (public path). */
export async function utmMapWorkspace(assetId: string): Promise<{ workspaceId: string; projectId: string | null } | null> {
  const rows = await getDb()
    .select()
    .from(utmVariantMaps)
    .where(eq(utmVariantMaps.assetId, assetId))
    .limit(1);
  return rows[0] ? { workspaceId: rows[0].workspaceId, projectId: rows[0].projectId } : null;
}

/** Variant impression → ledger (WO-041). */
export async function recordVariantImpression(params: {
  assetId: string;
  utmContent: string;
  matched: boolean;
  ref: string;
}): Promise<boolean> {
  const owner = await utmMapWorkspace(params.assetId);
  if (!owner) return false;
  return recordEvent({
    workspaceId: owner.workspaceId,
    projectId: owner.projectId,
    assetId: params.assetId,
    type: 'page_view',
    value: { kind: 'mm_impression', utm_content: params.utmContent, matched: params.matched },
    sessionRef: params.ref,
    source: 'pixel',
    dedupeKey: `mm:${params.assetId}:${params.ref}`,
  });
}

/**
 * Congruence report (WO-041): every tagged ad piece vs the variant maps —
 * ads whose utm_content has no mapped variant are FLAGGED.
 */
export async function congruenceReport(
  workspaceId: string,
  projectId: string,
): Promise<{
  mapped: Array<{ utmContent: string; assetId: string; angle: string }>;
  flagged: Array<{ utmContent: string; sourceAdAssetId: string; targetAssetId: string; reason: string }>;
}> {
  const db = tenantDb(workspaceId);
  const maps = await db.findMany(utmVariantMaps, eq(utmVariantMaps.projectId, projectId));
  const mappedKeys = new Set(maps.map((m) => `${m.assetId}:${m.utmContent}`));

  // Enumerate every ad↔lead tag in the project's ad assets.
  const { assets: assetsTable } = await import('./schema/index.js');
  const { listAssetVersions } = await import('./assetsStore.js');
  const adAssets = (await db.findMany(assetsTable, eq(assetsTable.projectId, projectId))).filter((a) =>
    ['meta_ad', 'youtube_ad', 'native_ad', 'advertorial'].includes(a.type),
  );
  const flagged: Array<{ utmContent: string; sourceAdAssetId: string; targetAssetId: string; reason: string }> = [];
  for (const ad of adAssets) {
    const versions = await listAssetVersions(workspaceId, ad.id);
    const current = versions[versions.length - 1];
    if (!current) continue;
    const tags: Array<{ utmContent: string; target: string }> = [];
    for (const block of current.blocks as Array<{ id: string; meta?: { messageMatch?: { assetId: string } } }>) {
      if (block.meta?.messageMatch?.assetId) {
        tags.push({ utmContent: `${ad.type}:${block.id}`, target: block.meta.messageMatch.assetId });
      }
    }
    const versionMatch = (current.meta as { messageMatch?: { assetId: string } } | null)?.messageMatch;
    if (tags.length === 0 && versionMatch?.assetId) {
      tags.push({ utmContent: `${ad.type}:script`, target: versionMatch.assetId });
    }
    for (const tag of tags) {
      if (!mappedKeys.has(`${tag.target}:${tag.utmContent}`)) {
        flagged.push({
          utmContent: tag.utmContent,
          sourceAdAssetId: ad.id,
          targetAssetId: tag.target,
          reason: 'Ad is tagged but no variant map exists — package the target asset (G7) to seed it.',
        });
      }
    }
  }
  return {
    mapped: maps.map((m) => ({
      utmContent: m.utmContent ?? '',
      assetId: m.assetId ?? '',
      angle: (m.headlineVariant as { angle?: string } | null)?.angle ?? '',
    })),
    flagged,
  };
}
