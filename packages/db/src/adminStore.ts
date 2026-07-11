import { desc, eq, like, or, sql } from 'drizzle-orm';
import { getDb } from './client.js';
import {
  jobs,
  licenses,
  modelRoutes,
  usageLedger,
  users,
  workspaces,
} from './schema/index.js';

/**
 * Platform-admin queries (WO-052). Cross-workspace BY DESIGN — every caller
 * sits behind the adminProcedure guard (isPlatformAdmin), a role no workspace
 * owner holds. Usage aggregates expose counts and token totals, never content.
 */

const escapeLike = (q: string): string => q.replace(/[%_\\]/g, (c) => `\\${c}`);

export async function adminSearchUsers(query: string, limit = 20) {
  const q = `%${escapeLike(query.trim())}%`;
  return getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isPlatformAdmin: users.isPlatformAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(or(like(users.email, q), like(users.name, q)))
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function adminSearchWorkspaces(query: string, limit = 20) {
  const q = `%${escapeLike(query.trim())}%`;
  return getDb()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerUserId: workspaces.ownerUserId,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(or(like(workspaces.name, q), like(workspaces.id, q)))
    .orderBy(desc(workspaces.createdAt))
    .limit(limit);
}

export async function adminSearchLicenses(query: string, limit = 20) {
  const q = `%${escapeLike(query.trim())}%`;
  const rows = await getDb()
    .select()
    .from(licenses)
    .where(or(like(licenses.key, q), like(licenses.workspaceId, q)))
    .orderBy(desc(licenses.createdAt))
    .limit(limit);
  // Admin sees status/seats/binding — the key stays masked even here.
  return rows.map((l) => ({
    id: l.id,
    keyMasked: `${l.key.slice(0, 8)}…${l.key.slice(-4)}`,
    workspaceId: l.workspaceId,
    status: l.status,
    type: l.type,
    seats: l.seats,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
  }));
}

// --- Model routes editor -------------------------------------------------------------

export async function adminListModelRoutes() {
  const rows = await getDb().select().from(modelRoutes);
  return rows.sort(
    (a, b) => (a.workspaceId ?? '').localeCompare(b.workspaceId ?? '') || a.stage.localeCompare(b.stage),
  );
}

export async function adminUpdateModelRoute(params: {
  routeId: string;
  primaryModel?: string;
  fallbackChain?: string[];
  maxTokens?: number;
  active?: boolean;
}): Promise<void> {
  const { routeId, ...patch } = params;
  const set: Record<string, unknown> = {};
  if (patch.primaryModel !== undefined) set.primaryModel = patch.primaryModel;
  if (patch.fallbackChain !== undefined) set.fallbackChain = patch.fallbackChain;
  if (patch.maxTokens !== undefined) set.maxTokens = patch.maxTokens;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) return;
  await getDb().update(modelRoutes).set(set).where(eq(modelRoutes.id, routeId));
}

// --- Usage overview (counts + token totals, never content) ---------------------------

export interface AdminUsageRow {
  workspaceId: string;
  workspaceName: string;
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costEstUsd: number;
  jobsPending: number;
  jobsFailed: number;
}

export async function adminUsageOverview(limit = 50): Promise<AdminUsageRow[]> {
  const usage = await getDb()
    .select({
      workspaceId: usageLedger.workspaceId,
      calls: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${usageLedger.inputTokens}), 0)`,
      cacheReadTokens: sql<number>`COALESCE(SUM(${usageLedger.cacheReadTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${usageLedger.outputTokens}), 0)`,
      costEstUsd: sql<string>`COALESCE(SUM(${usageLedger.costEstUsd}), 0)`,
    })
    .from(usageLedger)
    .groupBy(usageLedger.workspaceId)
    .orderBy(sql`SUM(${usageLedger.outputTokens}) DESC`)
    .limit(limit);

  const jobAgg = await getDb()
    .select({
      workspaceId: jobs.workspaceId,
      status: jobs.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(jobs)
    .groupBy(jobs.workspaceId, jobs.status);
  const jobsBy = new Map<string, { pending: number; failed: number }>();
  for (const row of jobAgg) {
    const entry = jobsBy.get(row.workspaceId) ?? { pending: 0, failed: 0 };
    if (row.status === 'pending') entry.pending += Number(row.count);
    if (row.status === 'failed') entry.failed += Number(row.count);
    jobsBy.set(row.workspaceId, entry);
  }

  const wsIds = usage.map((u) => u.workspaceId);
  const names = wsIds.length
    ? await getDb().select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
    : [];
  const nameById = new Map(names.map((w) => [w.id, w.name]));

  return usage.map((u) => ({
    workspaceId: u.workspaceId,
    workspaceName: nameById.get(u.workspaceId) ?? '(unknown)',
    calls: Number(u.calls),
    inputTokens: Number(u.inputTokens),
    cacheReadTokens: Number(u.cacheReadTokens),
    outputTokens: Number(u.outputTokens),
    costEstUsd: Number(u.costEstUsd),
    jobsPending: jobsBy.get(u.workspaceId)?.pending ?? 0,
    jobsFailed: jobsBy.get(u.workspaceId)?.failed ?? 0,
  }));
}
