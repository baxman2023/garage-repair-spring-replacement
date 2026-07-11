import { eq } from 'drizzle-orm';
import { JOB_TYPES, type AssetStatus } from '@copyforge/core';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { enqueueJob } from './queue.js';
import { transitionAssetStatus } from './assetsStore.js';
import { assets, auditLog, gateReports } from './schema/index.js';

/**
 * Gate dashboard store (WO-033): the market × asset grid with G3–G7 states,
 * plus the owner-only block/approve/override actions — every override writes
 * `gate_reports.overridden_by` AND an `audit_log` row with the reason.
 */

export const ASSET_GATES = ['G3', 'G4', 'G5', 'G6', 'G7'] as const;
export type AssetGate = (typeof ASSET_GATES)[number];

/** Where the pipeline resumes after a gate is (over)passed. */
const POST_GATE_STATUS: Record<AssetGate, AssetStatus> = {
  G3: 'focus_group',
  G4: 'deslop',
  G5: 'compliance',
  G6: 'packaging',
  G7: 'approved',
};

/** The follow-on job for a gate override, when the next stage is automated. */
const POST_GATE_JOB: Partial<Record<AssetGate, string>> = {
  G3: JOB_TYPES.assetFocusGroup,
  G4: JOB_TYPES.assetDeslop,
  G5: JOB_TYPES.assetCompliance,
};

export interface GateCell {
  pass: boolean;
  overridden: boolean;
  at: Date;
  reportId: string;
}

export interface GateGridRow {
  assetId: string;
  assetType: string;
  marketId: string | null;
  status: string;
  gates: Record<AssetGate, GateCell | null>;
}

/** The project's asset × gate grid (latest report per gate). */
export async function projectGateGrid(
  workspaceId: string,
  projectId: string,
): Promise<GateGridRow[]> {
  const db = tenantDb(workspaceId);
  const assetRows = await db.findMany(assets, eq(assets.projectId, projectId));
  // G3–G7 reports are asset-level (assetId set, projectId null).
  const allAssetReports = (
    await Promise.all(
      assetRows.map((a) => db.findMany(gateReports, eq(gateReports.assetId, a.id))),
    )
  ).flat();
  const assetReports = new Map<string, typeof allAssetReports>();
  for (const r of allAssetReports) {
    if (!r.assetId) continue;
    const list = assetReports.get(r.assetId) ?? [];
    list.push(r);
    assetReports.set(r.assetId, list);
  }

  return assetRows
    .sort((a, b) => (a.marketId ?? '').localeCompare(b.marketId ?? '') || a.type.localeCompare(b.type))
    .map((asset) => {
      const gates = {} as Record<AssetGate, GateCell | null>;
      const mine = (assetReports.get(asset.id) ?? []).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
      );
      for (const gate of ASSET_GATES) {
        const latest = mine.find((r) => r.gate === gate);
        gates[gate] = latest
          ? {
              pass: latest.pass,
              overridden: latest.overriddenByUserId !== null,
              at: latest.createdAt,
              reportId: latest.id,
            }
          : null;
      }
      return {
        assetId: asset.id,
        assetType: asset.type,
        marketId: asset.marketId,
        status: asset.status,
        gates,
      };
    });
}

/** Drill-in: one gate's full latest report for an asset. */
export async function gateReportDetail(
  workspaceId: string,
  assetId: string,
  gate: AssetGate,
): Promise<{ pass: boolean; report: Record<string, unknown>; overriddenBy: string | null; overrideReason: string | null; at: Date } | null> {
  const rows = (
    await tenantDb(workspaceId).findMany(gateReports, eq(gateReports.assetId, assetId))
  )
    .filter((r) => r.gate === gate)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  const latest = rows[0];
  if (!latest) return null;
  return {
    pass: latest.pass,
    report: latest.report,
    overriddenBy: latest.overriddenByUserId,
    overrideReason: latest.overrideReason,
    at: latest.createdAt,
  };
}

/**
 * Owner override: record a PASSING gate report carrying `overridden_by` +
 * reason, write the audit row, resume the pipeline at the post-gate stage
 * (with `override` if the asset is blocked), and enqueue the next automated
 * gate where one exists.
 */
export async function overrideGate(params: {
  workspaceId: string;
  assetId: string;
  gate: AssetGate;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  if (!params.reason.trim()) throw new Error('An override reason is required (audited).');
  const db = tenantDb(params.workspaceId);
  const asset = await db.findFirst(assets, eq(assets.id, params.assetId));
  if (!asset) throw new Error('Asset not found.');

  await db.insert(gateReports, {
    assetId: params.assetId,
    projectId: null,
    gate: params.gate,
    pass: true,
    report: { overridden: true, reason: params.reason.trim() },
    overriddenByUserId: params.actorUserId,
    overrideReason: params.reason.trim(),
  });
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    action: 'gate.override',
    targetType: 'asset',
    targetId: params.assetId,
    meta: { gate: params.gate, reason: params.reason.trim(), fromStatus: asset.status },
  });

  const target = POST_GATE_STATUS[params.gate];
  if (asset.status !== target) {
    await transitionAssetStatus({
      workspaceId: params.workspaceId,
      assetId: params.assetId,
      to: target,
      override: asset.status === 'blocked',
      actorUserId: params.actorUserId,
      reason: params.reason.trim(),
    });
  }

  const nextJob = POST_GATE_JOB[params.gate];
  if (nextJob && asset.projectId && asset.marketId) {
    await enqueueJob({
      workspaceId: params.workspaceId,
      type: nextJob,
      payload: { projectId: asset.projectId, assetId: params.assetId, marketId: asset.marketId },
    });
  }
}

/** Owner block: pull an asset out of the flow, audited with a reason. */
export async function blockAsset(params: {
  workspaceId: string;
  assetId: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  if (!params.reason.trim()) throw new Error('A block reason is required (audited).');
  await transitionAssetStatus({
    workspaceId: params.workspaceId,
    assetId: params.assetId,
    to: 'blocked',
  });
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    action: 'asset.block',
    targetType: 'asset',
    targetId: params.assetId,
    meta: { reason: params.reason.trim() },
  });
}

/** Owner approve: packaging → approved (the human sign-off). */
export async function approveAsset(params: {
  workspaceId: string;
  assetId: string;
  actorUserId: string;
}): Promise<void> {
  await transitionAssetStatus({
    workspaceId: params.workspaceId,
    assetId: params.assetId,
    to: 'approved',
  });
  await getDb().insert(auditLog).values({
    id: newId(),
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    action: 'asset.approve',
    targetType: 'asset',
    targetId: params.assetId,
    meta: {},
  });
  // First approved asset per (project, market, type) auto-designates as
  // control (WO-044); later approvals never steal the slot.
  const { designateControlIfFirst } = await import('./controlsStore.js');
  await designateControlIfFirst({
    workspaceId: params.workspaceId,
    assetId: params.assetId,
    actorUserId: params.actorUserId,
  });
}
