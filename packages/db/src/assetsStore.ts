import { desc, eq } from 'drizzle-orm';
import { assertTransition, newId, type AssetStatus } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { withTxRetry } from './txRetry.js';
import {
  assetVersions,
  assets,
  councilReviews,
  gateReports,
  type AssetBlock,
} from './schema/index.js';

/**
 * Asset store (seeded in WO-020 for the Council; the full status machine and
 * block editor land in WO-021). Versions are immutable; the asset row points
 * at its current version.
 */

export type AssetRow = typeof assets.$inferSelect;
export type AssetVersionRow = typeof assetVersions.$inferSelect;
export type CouncilReviewRow = typeof councilReviews.$inferSelect;

export async function createAsset(params: {
  workspaceId: string;
  projectId: string;
  marketId?: string | null;
  type: AssetRow['type'];
  promptVersionId?: string | null;
  parentAssetId?: string | null;
  slug?: string | null;
}): Promise<string> {
  return tenantDb(params.workspaceId).insert(assets, {
    projectId: params.projectId,
    marketId: params.marketId ?? null,
    type: params.type,
    status: 'draft',
    promptVersionId: params.promptVersionId ?? null,
    parentAssetId: params.parentAssetId ?? null,
    slug: params.slug ?? null,
  });
}

export async function getAsset(workspaceId: string, assetId: string): Promise<AssetRow | null> {
  return tenantDb(workspaceId).findFirst(assets, eq(assets.id, assetId));
}

export async function getCurrentAssetVersion(
  workspaceId: string,
  assetId: string,
): Promise<AssetVersionRow | null> {
  const asset = await getAsset(workspaceId, assetId);
  if (!asset?.currentVersionId) return null;
  return tenantDb(workspaceId).findFirst(assetVersions, eq(assetVersions.id, asset.currentVersionId));
}

export async function listAssetVersions(
  workspaceId: string,
  assetId: string,
): Promise<AssetVersionRow[]> {
  const rows = await tenantDb(workspaceId).findMany(assetVersions, eq(assetVersions.assetId, assetId));
  return rows.sort((a, b) => b.version - a.version);
}

function countWords(blocks: AssetBlock[]): number {
  return blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
}

/** Append an immutable version and point the asset at it. */
export async function insertAssetVersion(params: {
  workspaceId: string;
  assetId: string;
  blocks: AssetBlock[];
  createdBy: 'system' | 'user' | 'challenger';
  promptVersionId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<{ id: string; version: number }> {
  const db = getDb();
  return withTxRetry(() =>
    db.transaction(async (tx) => {
      const asset = await tx.select().from(assets).where(eq(assets.id, params.assetId)).limit(1);
      if (!asset[0] || asset[0].workspaceId !== params.workspaceId) {
        throw new Error('Asset not found in this workspace.');
      }
      const latest = await tx
        .select({ version: assetVersions.version })
        .from(assetVersions)
        .where(eq(assetVersions.assetId, params.assetId))
        .orderBy(desc(assetVersions.version))
        .limit(1);
      const version = (latest[0]?.version ?? 0) + 1;
      const id = newId();
      await tx.insert(assetVersions).values({
        id,
        workspaceId: params.workspaceId,
        assetId: params.assetId,
        version,
        blocks: params.blocks,
        wordcount: countWords(params.blocks),
        createdBy: params.createdBy,
        promptVersionId: params.promptVersionId ?? null,
        meta: params.meta ?? null,
      });
      await tx.update(assets).set({ currentVersionId: id }).where(eq(assets.id, params.assetId));
      return { id, version };
    }),
  );
}

export async function insertCouncilReviews(params: {
  workspaceId: string;
  assetVersionId: string;
  results: Record<string, { score: number; verdict: 'pass' | 'revise'; top_fixes: string[]; line_notes: unknown[] }>;
}): Promise<void> {
  const db = tenantDb(params.workspaceId);
  for (const [lens, r] of Object.entries(params.results)) {
    await db.insert(councilReviews, {
      assetVersionId: params.assetVersionId,
      lens: lens as CouncilReviewRow['lens'],
      score: Math.round(r.score),
      verdict: r.verdict,
      notes: { top_fixes: r.top_fixes, line_notes: r.line_notes },
    });
  }
}

/** All council reviews for an asset, grouped by version (newest first). */
export async function listCouncilReviewsForAsset(
  workspaceId: string,
  assetId: string,
): Promise<Array<{ version: AssetVersionRow; reviews: CouncilReviewRow[] }>> {
  const versions = await listAssetVersions(workspaceId, assetId);
  const out: Array<{ version: AssetVersionRow; reviews: CouncilReviewRow[] }> = [];
  for (const version of versions) {
    const reviews = await tenantDb(workspaceId).findMany(
      councilReviews,
      eq(councilReviews.assetVersionId, version.id),
    );
    out.push({ version, reviews });
  }
  return out;
}

/** Record an asset-level gate verdict (G3–G7). */
export async function recordAssetGate(params: {
  workspaceId: string;
  assetId: string;
  gate: 'G3' | 'G4' | 'G5' | 'G6' | 'G7';
  pass: boolean;
  report: Record<string, unknown>;
}): Promise<void> {
  await tenantDb(params.workspaceId).insert(gateReports, {
    assetId: params.assetId,
    projectId: null,
    gate: params.gate,
    pass: params.pass,
    report: params.report,
  });
}

/**
 * Enforced status transition (WO-021): every move validated by the core
 * machine; owner overrides out of `blocked` are audited.
 */
export async function transitionAssetStatus(params: {
  workspaceId: string;
  assetId: string;
  to: AssetStatus;
  override?: boolean;
  actorUserId?: string | null;
  reason?: string;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(assets).where(eq(assets.id, params.assetId)).limit(1);
    const asset = rows[0];
    if (!asset || asset.workspaceId !== params.workspaceId) {
      throw new Error('Asset not found in this workspace.');
    }
    assertTransition(asset.status as AssetStatus, params.to, { override: params.override });
    await tx.update(assets).set({ status: params.to }).where(eq(assets.id, params.assetId));
    if (params.override) {
      const { auditLog } = await import('./schema/index.js');
      await tx.insert(auditLog).values({
        id: newId(),
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId ?? null,
        action: 'asset.status_override',
        targetType: 'asset',
        targetId: params.assetId,
        meta: { from: asset.status, to: params.to, reason: params.reason ?? '' },
      });
    }
  });
}

/** @deprecated WO-020 shim — use transitionAssetStatus. Kept for the council runner. */
export async function setAssetStatus(
  workspaceId: string,
  assetId: string,
  status: AssetRow['status'],
): Promise<void> {
  await transitionAssetStatus({ workspaceId, assetId, to: status as AssetStatus });
}

// --- Claims (WO-022 / WO-031) -------------------------------------------------

/**
 * Insert a version's extracted claims. Resolutions SURVIVE regeneration
 * (WO-031 acceptance): each incoming claim is text-similarity rematched
 * against the asset's existing claims, inheriting proofRef/status from a
 * resolved prior claim. Fresh assets have nothing to match — a no-op.
 */
export async function insertClaims(params: {
  workspaceId: string;
  assetId: string;
  assetVersionId: string;
  claims: Array<{ text: string; proofRef?: string; status?: 'proven' | 'flagged' }>;
}): Promise<number> {
  const { rematchClaims } = await import('@copyforge/core');
  const { claims } = await import('./schema/index.js');
  const db = tenantDb(params.workspaceId);
  const existing = await listClaims(params.workspaceId, params.assetId);
  const rematched = rematchClaims(
    params.claims.map((c) => ({
      text: c.text,
      proofRef: c.proofRef,
      status: c.status ?? (c.proofRef ? 'proven' : undefined),
    })),
    existing.map((e) => ({ text: e.text, proofRef: e.proofRef, status: e.status })),
  );
  for (const c of rematched) {
    await db.insert(claims, {
      assetId: params.assetId,
      assetVersionId: params.assetVersionId,
      text: c.text,
      proofRef: c.proofRef,
      status: c.status,
    });
  }
  return rematched.length;
}

export async function listClaims(workspaceId: string, assetId: string) {
  const { claims } = await import('./schema/index.js');
  return tenantDb(workspaceId).findMany(claims, eq(claims.assetId, assetId));
}

/** Claims for the asset's CURRENT version (what gates and the UI act on). */
export async function listCurrentClaims(workspaceId: string, assetId: string) {
  const version = await getCurrentAssetVersion(workspaceId, assetId);
  const all = await listClaims(workspaceId, assetId);
  if (!version) return all;
  const current = all.filter((c) => c.assetVersionId === version.id);
  return current.length > 0 ? current : all;
}

/** Proof linker: attach a proof ref → proven. */
export async function attachClaimProof(params: {
  workspaceId: string;
  claimId: string;
  proofRef: string;
}): Promise<void> {
  const { claims } = await import('./schema/index.js');
  if (!params.proofRef.trim()) throw new Error('A proof reference is required.');
  await tenantDb(params.workspaceId).update(
    claims,
    { proofRef: params.proofRef.trim(), status: 'proven' },
    eq(claims.id, params.claimId),
  );
}

/** Proof linker: reset a claim back to flagged (detaches its proof). */
export async function resetClaimToFlagged(params: {
  workspaceId: string;
  claimId: string;
}): Promise<void> {
  const { claims } = await import('./schema/index.js');
  await tenantDb(params.workspaceId).update(
    claims,
    { proofRef: null, status: 'flagged' },
    eq(claims.id, params.claimId),
  );
}

/** Flag report per asset (WO-031): current-version claims, proven vs flagged. */
export async function claimsFlagReport(workspaceId: string, assetId: string) {
  const { buildClaimsFlagReport } = await import('@copyforge/core');
  const current = await listCurrentClaims(workspaceId, assetId);
  return buildClaimsFlagReport(current.map((c) => ({ text: c.text, status: c.status })));
}
