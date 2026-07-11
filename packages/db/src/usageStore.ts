import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { assets as assetsTable, projects, usageLedger } from './schema/index.js';

/**
 * User-facing usage & cost views (WO-053). BYO-key transparency: everything
 * sums straight from `usage_ledger`, so the dashboard reconciles with the
 * ledger by construction, and the pre-build estimate is honest about its
 * basis (this workspace's observed averages, or documented defaults).
 */

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costEstUsd: number;
  /** cacheRead / (input + cacheRead) — how much prompt caching is saving. */
  cacheHitRate: number;
}

function totalsOf(rows: Array<{ inputTokens: number; cacheReadTokens: number; outputTokens: number; costEstUsd: string }>): UsageTotals {
  const t = rows.reduce(
    (acc, r) => {
      acc.calls++;
      acc.inputTokens += r.inputTokens;
      acc.cacheReadTokens += r.cacheReadTokens;
      acc.outputTokens += r.outputTokens;
      acc.costEstUsd += Number(r.costEstUsd);
      return acc;
    },
    { calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costEstUsd: 0 },
  );
  const denominator = t.inputTokens + t.cacheReadTokens;
  return {
    ...t,
    costEstUsd: Math.round(t.costEstUsd * 1e6) / 1e6,
    cacheHitRate: denominator > 0 ? t.cacheReadTokens / denominator : 0,
  };
}

/** Workspace totals + per-project breakdown. */
export async function workspaceUsage(workspaceId: string): Promise<{
  total: UsageTotals;
  perProject: Array<{ projectId: string | null; projectName: string; usage: UsageTotals }>;
}> {
  const db = tenantDb(workspaceId);
  const rows = await db.findMany(usageLedger, undefined);
  const projectRows = await db.findMany(projects, undefined);
  const nameById = new Map(projectRows.map((p) => [p.id, p.name]));

  const byProject = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const key = row.projectId ?? null;
    byProject.set(key, [...(byProject.get(key) ?? []), row]);
  }
  return {
    total: totalsOf(rows),
    perProject: [...byProject.entries()]
      .map(([projectId, group]) => ({
        projectId,
        projectName: projectId ? (nameById.get(projectId) ?? '(deleted project)') : '(workspace-level)',
        usage: totalsOf(group),
      }))
      .sort((a, b) => b.usage.costEstUsd - a.usage.costEstUsd),
  };
}

/** Per-stage breakdown for one project. */
export async function projectUsage(workspaceId: string, projectId: string) {
  const rows = await tenantDb(workspaceId).findMany(usageLedger, eq(usageLedger.projectId, projectId));
  const byStage = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.stage ?? '(unrouted)';
    byStage.set(key, [...(byStage.get(key) ?? []), row]);
  }
  return {
    total: totalsOf(rows),
    perStage: [...byStage.entries()]
      .map(([stage, group]) => ({ stage, usage: totalsOf(group) }))
      .sort((a, b) => b.usage.costEstUsd - a.usage.costEstUsd),
  };
}

/** Monthly summary (UTC calendar months). */
export async function monthlyUsage(workspaceId: string): Promise<Array<{ month: string; usage: UsageTotals }>> {
  const rows = await tenantDb(workspaceId).findMany(usageLedger, undefined);
  const byMonth = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.createdAt.toISOString().slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
  }
  return [...byMonth.entries()]
    .map(([month, group]) => ({ month, usage: totalsOf(group) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

// --- Pre-build cost estimate ---------------------------------------------------------

/**
 * Documented defaults for a workspace with no history yet (config averages:
 * one full gate ladder per asset at seeded model routes, ~mid-size funnel
 * copy). Replaced by the workspace's own observed averages as soon as one
 * build exists.
 */
export const DEFAULT_PER_ASSET_ESTIMATE = {
  costUsd: 0.9,
  outputTokens: 12_000,
} as const;

export interface BuildEstimate {
  plannedAssets: number;
  perAssetCostUsd: number;
  totalCostUsd: number;
  perAssetOutputTokens: number;
  totalOutputTokens: number;
  basis: 'workspace-history' | 'defaults';
  note: string;
}

/**
 * Estimate a fan-out BEFORE it runs. Basis: this workspace's observed
 * generation cost per built asset (total stage-attributed ledger cost /
 * assets created), falling back to documented defaults with a clear note.
 */
export async function buildCostEstimate(
  workspaceId: string,
  planned: { marketCount: number; assetTypeCount: number },
): Promise<BuildEstimate> {
  const plannedAssets = Math.max(0, planned.marketCount * planned.assetTypeCount);

  const [usage] = await getDb()
    .select({
      cost: sql<string>`COALESCE(SUM(${usageLedger.costEstUsd}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${usageLedger.outputTokens}), 0)`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.workspaceId, workspaceId), isNotNull(usageLedger.stage)));
  const [assetCount] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(assetsTable)
    .where(eq(assetsTable.workspaceId, workspaceId));

  const built = Number(assetCount?.n ?? 0);
  const historyCost = Number(usage?.cost ?? 0);

  if (built > 0 && historyCost > 0) {
    const perAssetCostUsd = historyCost / built;
    const perAssetOutputTokens = Number(usage!.outputTokens) / built;
    return {
      plannedAssets,
      perAssetCostUsd: round6(perAssetCostUsd),
      totalCostUsd: round6(perAssetCostUsd * plannedAssets),
      perAssetOutputTokens: Math.round(perAssetOutputTokens),
      totalOutputTokens: Math.round(perAssetOutputTokens * plannedAssets),
      basis: 'workspace-history',
      note: `Based on this workspace's observed average across ${built} built asset${built === 1 ? '' : 's'}.`,
    };
  }
  return {
    plannedAssets,
    perAssetCostUsd: DEFAULT_PER_ASSET_ESTIMATE.costUsd,
    totalCostUsd: round6(DEFAULT_PER_ASSET_ESTIMATE.costUsd * plannedAssets),
    perAssetOutputTokens: DEFAULT_PER_ASSET_ESTIMATE.outputTokens,
    totalOutputTokens: DEFAULT_PER_ASSET_ESTIMATE.outputTokens * plannedAssets,
    basis: 'defaults',
    note: 'No build history yet — this is the documented default per-asset average.',
  };
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
