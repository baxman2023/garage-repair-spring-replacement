import { desc, eq } from 'drizzle-orm';
import { newId, parseMarketProfile, snapshotHash } from '@copyforge/core';
import { getDb } from './client.js';
import { listMarkets } from './markets.js';
import { gateReports, projects } from './schema/index.js';

/**
 * Strategy Review — gate G2 (WO-015). Approval snapshots the five diagnosed
 * market profiles and records their canonical hash. Fan-out requires a
 * passing G2 whose hash still matches the CURRENT markets — editing a market
 * after approval invalidates it (re-approve to proceed).
 */

export interface G2Snapshot {
  markets: Array<Record<string, unknown>>;
  hash: string;
}

/** Build the current snapshot; throws unless 5 contract-valid diagnosed markets. */
export async function buildStrategySnapshot(
  workspaceId: string,
  projectId: string,
): Promise<G2Snapshot> {
  const rows = await listMarkets(workspaceId, projectId);
  if (rows.length !== 5) {
    throw new Error(`G2 needs exactly 5 markets (found ${rows.length}).`);
  }
  const profiles = rows.map((r) => {
    try {
      return parseMarketProfile(r.profile) as unknown as Record<string, unknown>;
    } catch {
      throw new Error(`Market "${r.label}" (rank ${r.rank}) is not fully diagnosed yet.`);
    }
  });
  return { markets: profiles, hash: snapshotHash(profiles) };
}

/** Record a G2 approval with its immutable snapshot. */
export async function recordG2(params: {
  workspaceId: string;
  projectId: string;
  snapshot: G2Snapshot;
}): Promise<string> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const project = await tx
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);
    if (!project[0] || project[0].workspaceId !== params.workspaceId) {
      throw new Error('Project not found in this workspace.');
    }
    const id = newId();
    await tx.insert(gateReports).values({
      id,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      assetId: null,
      gate: 'G2',
      pass: true,
      report: { hash: params.snapshot.hash, markets: params.snapshot.markets },
    });
    await tx
      .update(projects)
      .set({ status: 'build' })
      .where(eq(projects.id, params.projectId));
    return id;
  });
}

export interface G2Status {
  approved: boolean;
  /** Approval exists but markets changed since — must re-approve. */
  stale: boolean;
  approvedHash: string | null;
  currentHash: string | null;
}

export async function getG2Status(workspaceId: string, projectId: string): Promise<G2Status> {
  const reports = await getDb()
    .select()
    .from(gateReports)
    .where(eq(gateReports.projectId, projectId))
    .orderBy(desc(gateReports.createdAt), desc(gateReports.id));
  const latest = reports.find(
    (r) => r.workspaceId === workspaceId && r.gate === 'G2' && r.pass,
  );
  const approvedHash = latest ? ((latest.report as { hash?: string }).hash ?? null) : null;

  let currentHash: string | null = null;
  try {
    currentHash = (await buildStrategySnapshot(workspaceId, projectId)).hash;
  } catch {
    currentHash = null;
  }

  const approved = Boolean(approvedHash && currentHash && approvedHash === currentHash);
  return {
    approved,
    stale: Boolean(approvedHash) && !approved,
    approvedHash,
    currentHash,
  };
}

/** Fan-out gate: throws unless a current (non-stale) G2 approval exists. */
export async function assertG2Approved(workspaceId: string, projectId: string): Promise<void> {
  const status = await getG2Status(workspaceId, projectId);
  if (status.approved) return;
  if (status.stale) {
    throw new Error('G2 stale: markets changed since approval — re-approve the strategy first.');
  }
  throw new Error('G2 required: approve the strategy review before building.');
}
