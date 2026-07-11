import { and, eq } from 'drizzle-orm';
import {
  evaluatePromotion,
  newId,
  DEFAULT_PROMOTION_CONFIG,
  type ArmMetrics,
  type PromotionConfig,
  type PromotionVerdict,
} from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { auditLog, challengers, controls, events, assets as assetsTable } from './schema/index.js';

/**
 * Controls & challengers (WO-044). The first APPROVED asset per
 * (project, market, asset_type) auto-designates as control. Challengers walk
 * queued → live → won|lost; promotion requires the volume floor AND the
 * directional uplift heuristic, swaps the control pointer, and appends to an
 * immutable lineage (audit rows + challenger rows are never rewritten).
 */

export type ControlRow = typeof controls.$inferSelect;
export type ChallengerRow = typeof challengers.$inferSelect;

/** Auto-control on first approval; later approvals never steal the slot. */
export async function designateControlIfFirst(params: {
  workspaceId: string;
  assetId: string;
  actorUserId?: string | null;
}): Promise<{ designated: boolean; controlId: string | null }> {
  const db = tenantDb(params.workspaceId);
  const asset = await db.findFirst(assetsTable, eq(assetsTable.id, params.assetId));
  if (!asset || !asset.marketId) return { designated: false, controlId: null };
  const existing = await db.findFirst(
    controls,
    and(
      eq(controls.projectId, asset.projectId),
      eq(controls.marketId, asset.marketId),
      eq(controls.assetType, asset.type),
    ),
  );
  if (existing) return { designated: false, controlId: existing.id };

  const controlId = await db.insert(controls, {
    projectId: asset.projectId,
    marketId: asset.marketId,
    assetType: asset.type,
    assetId: asset.id,
    since: new Date(),
  });
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId ?? null,
    action: 'control.designated',
    targetType: 'control',
    targetId: controlId,
    meta: { assetId: asset.id, assetType: asset.type, marketId: asset.marketId, reason: 'first approved asset' },
  });
  return { designated: true, controlId };
}

export async function createChallenger(params: {
  workspaceId: string;
  controlId: string;
  assetId: string;
  sourceNote?: string;
}): Promise<string> {
  const db = tenantDb(params.workspaceId);
  const control = await db.findFirst(controls, eq(controls.id, params.controlId));
  if (!control) throw new Error('Control not found.');
  if (control.assetId === params.assetId) throw new Error('An asset cannot challenge itself.');
  const id = await db.insert(challengers, {
    controlId: params.controlId,
    assetId: params.assetId,
    status: 'queued',
  });
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: null,
    action: 'challenger.created',
    targetType: 'control',
    targetId: params.controlId,
    meta: { challengerId: id, assetId: params.assetId, source: params.sourceNote ?? '' },
  });
  return id;
}

export async function setChallengerLive(params: {
  workspaceId: string;
  challengerId: string;
}): Promise<void> {
  const db = tenantDb(params.workspaceId);
  const row = await db.findFirst(challengers, eq(challengers.id, params.challengerId));
  if (!row) throw new Error('Challenger not found.');
  if (row.status !== 'queued') throw new Error(`Challenger is ${row.status} — only queued challengers go live.`);
  await db.update(challengers, { status: 'live' }, eq(challengers.id, params.challengerId));
}

/** Arm metrics from the ledger: visitors = page_view, conversions = sale. */
export async function armMetrics(workspaceId: string, assetId: string): Promise<ArmMetrics> {
  const rows = await tenantDb(workspaceId).findMany(events, eq(events.assetId, assetId));
  return {
    visitors: rows.filter((r) => r.type === 'page_view').length,
    conversions: rows.filter((r) => r.type === 'sale').length,
  };
}

/**
 * Attempt promotion. THROWS below the volume floor or when the heuristic says
 * no (acceptance: promotion impossible below min volume). On success the
 * control pointer swaps, the challenger is marked won, and lineage is
 * appended — nothing historical is rewritten.
 */
export async function promoteChallenger(params: {
  workspaceId: string;
  challengerId: string;
  actorUserId?: string | null;
  config?: PromotionConfig;
}): Promise<PromotionVerdict> {
  const db = tenantDb(params.workspaceId);
  const challenger = await db.findFirst(challengers, eq(challengers.id, params.challengerId));
  if (!challenger) throw new Error('Challenger not found.');
  if (challenger.status !== 'live') throw new Error(`Challenger is ${challenger.status} — only live challengers promote.`);
  const control = await db.findFirst(controls, eq(controls.id, challenger.controlId));
  if (!control) throw new Error('Control not found.');

  const verdict = evaluatePromotion({
    control: await armMetrics(params.workspaceId, control.assetId),
    challenger: await armMetrics(params.workspaceId, challenger.assetId),
    config: params.config ?? DEFAULT_PROMOTION_CONFIG,
  });
  if (!verdict.promote) throw new Error(`Promotion refused: ${verdict.reason}`);

  const previousAssetId = control.assetId;
  await db.update(
    controls,
    { assetId: challenger.assetId, since: new Date() },
    eq(controls.id, control.id),
  );
  await db.update(challengers, { status: 'won' }, eq(challengers.id, challenger.id));
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId ?? null,
    action: 'control.promoted',
    targetType: 'control',
    targetId: control.id,
    meta: {
      fromAssetId: previousAssetId,
      toAssetId: challenger.assetId,
      challengerId: challenger.id,
      verdict: {
        controlRate: verdict.controlRate,
        challengerRate: verdict.challengerRate,
        uplift: verdict.uplift,
        zScore: verdict.zScore,
      },
    },
  });
  return verdict;
}

export async function markChallengerLost(params: {
  workspaceId: string;
  challengerId: string;
  reason?: string;
}): Promise<void> {
  const db = tenantDb(params.workspaceId);
  const row = await db.findFirst(challengers, eq(challengers.id, params.challengerId));
  if (!row) throw new Error('Challenger not found.');
  if (row.status !== 'live') throw new Error(`Challenger is ${row.status} — only live challengers lose.`);
  await db.update(challengers, { status: 'lost' }, eq(challengers.id, params.challengerId));
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: null,
    action: 'challenger.lost',
    targetType: 'control',
    targetId: row.controlId,
    meta: { challengerId: params.challengerId, reason: params.reason ?? '' },
  });
}

/** Control lineage: designation + every promotion, oldest first (immutable). */
export async function controlLineage(
  workspaceId: string,
  controlId: string,
): Promise<Array<{ action: string; at: Date; meta: Record<string, unknown> }>> {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.targetId, controlId)));
  return rows
    .filter((r) => ['control.designated', 'control.promoted', 'challenger.created', 'challenger.lost'].includes(r.action))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((r) => ({ action: r.action, at: r.createdAt, meta: (r.meta ?? {}) as Record<string, unknown> }));
}

export async function listControls(workspaceId: string, projectId: string) {
  const db = tenantDb(workspaceId);
  const rows = await db.findMany(controls, eq(controls.projectId, projectId));
  const result = [];
  for (const control of rows) {
    const challengerRows = await db.findMany(challengers, eq(challengers.controlId, control.id));
    result.push({ control, challengers: challengerRows });
  }
  return result;
}
