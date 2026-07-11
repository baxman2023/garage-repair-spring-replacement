import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
  autopsyToDumpText,
  JOB_TYPES,
  parseAutopsyIntake,
  parseAutopsyReport,
  type AutopsyIntake,
  type AutopsyPage,
  type AutopsyReport,
} from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { enqueueJob } from './queue.js';
import { autopsies, projects, type AutopsyStatus } from './schema/index.js';

/**
 * Autopsy Mode store (WO-047). The share token is the only public handle;
 * `getAutopsyByShareToken` returns a read-only view and NOTHING tenant-scoped
 * beyond the report itself — revocation nulls the token and the link dies.
 */

export async function createAutopsy(params: {
  workspaceId: string;
  intake: AutopsyIntake;
}): Promise<string> {
  const intake = parseAutopsyIntake(params.intake);
  return tenantDb(params.workspaceId).insert(autopsies, {
    title: intake.title,
    status: 'draft',
    pages: intake.pages as unknown as Array<Record<string, unknown>>,
  });
}

export async function getAutopsy(workspaceId: string, autopsyId: string) {
  return tenantDb(workspaceId).findFirst(autopsies, eq(autopsies.id, autopsyId));
}

export async function listAutopsies(workspaceId: string) {
  const rows = await tenantDb(workspaceId).findMany(autopsies, undefined);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}

/** Queue the teardown; re-queues are allowed (a fresh run replaces the report). */
export async function queueAutopsyRun(workspaceId: string, autopsyId: string): Promise<string> {
  const row = await getAutopsy(workspaceId, autopsyId);
  if (!row) throw new Error('Autopsy not found.');
  await tenantDb(workspaceId).update(autopsies, {
    status: 'queued',
    error: null,
  }, eq(autopsies.id, autopsyId));
  return enqueueJob({
    workspaceId,
    type: JOB_TYPES.autopsyRun,
    payload: { autopsyId },
  });
}

export async function setAutopsyStatus(
  workspaceId: string,
  autopsyId: string,
  status: AutopsyStatus,
  error?: string,
): Promise<void> {
  await tenantDb(workspaceId).update(autopsies, {
    status,
    error: error ?? null,
  }, eq(autopsies.id, autopsyId));
}

/** Persist fetched page content back onto the intake (URL auto-fetch). */
export async function saveAutopsyPages(
  workspaceId: string,
  autopsyId: string,
  pages: AutopsyPage[],
): Promise<void> {
  await tenantDb(workspaceId).update(autopsies, {
    pages: pages as unknown as Array<Record<string, unknown>>,
  }, eq(autopsies.id, autopsyId));
}

export async function saveAutopsyReport(
  workspaceId: string,
  autopsyId: string,
  report: AutopsyReport,
): Promise<void> {
  await tenantDb(workspaceId).update(autopsies, {
    report: report as unknown as Record<string, unknown>,
    status: 'complete',
    error: null,
  }, eq(autopsies.id, autopsyId));
}

// --- Public sharing -------------------------------------------------------------

export async function shareAutopsy(workspaceId: string, autopsyId: string): Promise<string> {
  const row = await getAutopsy(workspaceId, autopsyId);
  if (!row) throw new Error('Autopsy not found.');
  if (row.status !== 'complete' || !row.report) throw new Error('Only completed autopsies can be shared.');
  if (row.shareToken) return row.shareToken;
  const token = `at_${randomBytes(24).toString('hex')}`;
  await tenantDb(workspaceId).update(autopsies, { shareToken: token }, eq(autopsies.id, autopsyId));
  return token;
}

export async function revokeAutopsyShare(workspaceId: string, autopsyId: string): Promise<void> {
  await tenantDb(workspaceId).update(autopsies, { shareToken: null }, eq(autopsies.id, autopsyId));
}

export interface PublicAutopsyView {
  title: string;
  report: AutopsyReport;
  createdAt: Date;
}

/**
 * PUBLIC read-only path: token → report. Returns title/report/date only —
 * no ids, no workspace, no page URLs. Null token (revoked) never matches.
 */
export async function getAutopsyByShareToken(token: string): Promise<PublicAutopsyView | null> {
  if (!/^at_[0-9a-f]{48}$/.test(token)) return null;
  const rows = await getDb()
    .select()
    .from(autopsies)
    .where(and(eq(autopsies.shareToken, token), isNotNull(autopsies.report)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    title: row.title,
    report: parseAutopsyReport(row.report),
    createdAt: row.createdAt,
  };
}

// --- Rebuild in CopyForge -------------------------------------------------------

/**
 * The "rebuild in CopyForge" CTA: creates a project and pre-fills Sales
 * Detective by queueing the standard intake extraction over the autopsied
 * funnel content + teardown findings. Idempotent per autopsy.
 */
export async function rebuildFromAutopsy(params: {
  workspaceId: string;
  autopsyId: string;
}): Promise<{ projectId: string; jobId: string | null }> {
  const row = await getAutopsy(params.workspaceId, params.autopsyId);
  if (!row) throw new Error('Autopsy not found.');
  if (row.status !== 'complete' || !row.report) throw new Error('Run the autopsy before rebuilding.');
  if (row.rebuiltProjectId) return { projectId: row.rebuiltProjectId, jobId: null };

  const report = parseAutopsyReport(row.report);
  const dumpText = autopsyToDumpText(row.pages as unknown as AutopsyPage[], report);
  const projectId = await tenantDb(params.workspaceId).insert(projects, {
    name: `Rebuild: ${row.title}`.slice(0, 255),
  });
  const jobId = await enqueueJob({
    workspaceId: params.workspaceId,
    type: JOB_TYPES.intakeExtractProfile,
    payload: { projectId, text: dumpText },
  });
  await tenantDb(params.workspaceId).update(autopsies, {
    rebuiltProjectId: projectId,
  }, eq(autopsies.id, params.autopsyId));
  return { projectId, jobId };
}
