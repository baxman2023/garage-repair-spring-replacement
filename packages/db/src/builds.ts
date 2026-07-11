import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { buildFunnelPlan, JOB_TYPES, type FunnelAssetType } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { enqueueGenerationJob } from './funnelMath.js';
import { assertG2Approved } from './strategyGate.js';
import { listMarkets } from './markets.js';
import { funnelBuilds, funnelBuildSteps, usageLedger } from './schema/index.js';

/**
 * Fan-out build store (WO-028). A build is one "Build All" run: an ordered
 * step chain (market-major per §1.2) driven by chained `build.step` jobs. The
 * step rows are the durable resume ledger; the ledger's cache columns make the
 * cache hit rate observable per market.
 */

export type FunnelBuildRow = typeof funnelBuilds.$inferSelect;
export type FunnelBuildStepRow = typeof funnelBuildSteps.$inferSelect;

/** Start a build (the "Build All" action). Post-G2 only; one running build per project. */
export async function startFunnelBuild(params: {
  workspaceId: string;
  projectId: string;
  /** Restrict to specific market ranks (1-5); default all diagnosed markets. */
  marketRanks?: number[];
  /** Restrict the per-market chain; default the full funnel sequence. */
  assetTypes?: FunnelAssetType[];
}): Promise<string> {
  await assertG2Approved(params.workspaceId, params.projectId);

  const db = tenantDb(params.workspaceId);
  const running = await db.findMany(
    funnelBuilds,
    and(eq(funnelBuilds.projectId, params.projectId), eq(funnelBuilds.status, 'running')),
  );
  if (running.length > 0) {
    throw new Error('A build is already running for this project — cancel it or let it finish.');
  }

  const markets = await listMarkets(params.workspaceId, params.projectId);
  const chosen = params.marketRanks?.length
    ? markets.filter((m) => params.marketRanks!.includes(m.rank))
    : markets;
  if (chosen.length === 0) throw new Error('No markets matched the requested ranks.');

  const steps = buildFunnelPlan(
    chosen.map((m) => m.id),
    params.assetTypes,
  );

  const buildId = await db.insert(funnelBuilds, {
    projectId: params.projectId,
    status: 'running',
    plan: {
      markets: chosen.map((m) => ({ id: m.id, rank: m.rank, label: m.label })),
      assetTypes: params.assetTypes ?? null,
      stepCount: steps.length,
    },
  });
  for (const step of steps) {
    await db.insert(funnelBuildSteps, {
      buildId,
      marketId: step.marketId,
      assetType: step.assetType,
      seq: step.seq,
      status: 'pending',
    });
  }

  await enqueueBuildStep(params.workspaceId, params.projectId, buildId, 0);
  return buildId;
}

/** Enqueue the chained job for one step (generation-class → G1-guarded). */
export async function enqueueBuildStep(
  workspaceId: string,
  projectId: string,
  buildId: string,
  seq: number,
): Promise<string> {
  return enqueueGenerationJob({
    workspaceId,
    projectId,
    type: JOB_TYPES.buildStep,
    payload: { projectId, buildId, seq },
  });
}

export async function getBuild(
  workspaceId: string,
  buildId: string,
): Promise<FunnelBuildRow | null> {
  return tenantDb(workspaceId).findFirst(funnelBuilds, eq(funnelBuilds.id, buildId));
}

export async function listBuildSteps(
  workspaceId: string,
  buildId: string,
): Promise<FunnelBuildStepRow[]> {
  const rows = await tenantDb(workspaceId).findMany(
    funnelBuildSteps,
    eq(funnelBuildSteps.buildId, buildId),
  );
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function getBuildStep(
  workspaceId: string,
  buildId: string,
  seq: number,
): Promise<FunnelBuildStepRow | null> {
  return tenantDb(workspaceId).findFirst(
    funnelBuildSteps,
    and(eq(funnelBuildSteps.buildId, buildId), eq(funnelBuildSteps.seq, seq)),
  );
}

export async function updateBuildStep(
  workspaceId: string,
  stepId: string,
  patch: Partial<{
    status: FunnelBuildStepRow['status'];
    jobId: string;
    assetIds: string[];
    error: string;
  }>,
): Promise<void> {
  await tenantDb(workspaceId).update(funnelBuildSteps, patch, eq(funnelBuildSteps.id, stepId));
}

export async function setBuildStatus(
  workspaceId: string,
  buildId: string,
  status: FunnelBuildRow['status'],
): Promise<void> {
  await tenantDb(workspaceId).update(funnelBuilds, { status }, eq(funnelBuilds.id, buildId));
}

/** Cancel: stop the chain. Pending steps become skipped; the in-flight step checks status. */
export async function cancelFunnelBuild(workspaceId: string, buildId: string): Promise<void> {
  const db = tenantDb(workspaceId);
  const build = await db.findFirst(funnelBuilds, eq(funnelBuilds.id, buildId));
  if (!build) throw new Error('Build not found.');
  if (build.status !== 'running') throw new Error(`Build is ${build.status} — nothing to cancel.`);
  await db.update(funnelBuilds, { status: 'canceled' }, eq(funnelBuilds.id, buildId));
  await db.update(
    funnelBuildSteps,
    { status: 'skipped' },
    and(eq(funnelBuildSteps.buildId, buildId), eq(funnelBuildSteps.status, 'pending')),
  );
}

/**
 * Resume-from-failure: re-arm the first failed/orphaned step of a build and
 * re-enqueue its chained job. Also revives a canceled build if asked.
 */
export async function resumeFunnelBuild(workspaceId: string, buildId: string): Promise<number> {
  const db = tenantDb(workspaceId);
  const build = await db.findFirst(funnelBuilds, eq(funnelBuilds.id, buildId));
  if (!build) throw new Error('Build not found.');
  if (build.status === 'done') throw new Error('Build already completed.');

  const steps = await listBuildSteps(workspaceId, buildId);
  const next = steps.find((s) => s.status !== 'done');
  if (!next) {
    await setBuildStatus(workspaceId, buildId, 'done');
    return -1;
  }
  await db.update(
    funnelBuildSteps,
    { status: 'pending' },
    and(
      eq(funnelBuildSteps.buildId, buildId),
      gte(funnelBuildSteps.seq, next.seq),
      inArray(funnelBuildSteps.status, ['failed', 'skipped', 'running']),
    ),
  );
  await setBuildStatus(workspaceId, buildId, 'running');
  await enqueueBuildStep(workspaceId, build.projectId, buildId, next.seq);
  return next.seq;
}

export interface BuildCacheStats {
  overall: { inputTokens: number; cacheReadTokens: number; hitRate: number };
  perMarket: Array<{
    marketId: string;
    inputTokens: number;
    cacheReadTokens: number;
    hitRate: number;
  }>;
}

/** Cache observability (§1.2): hit rate from the usage ledger, per market. */
export async function buildCacheStats(
  workspaceId: string,
  buildId: string,
): Promise<BuildCacheStats> {
  const steps = await listBuildSteps(workspaceId, buildId);
  const jobToMarket = new Map<string, string>();
  for (const s of steps) if (s.jobId) jobToMarket.set(s.jobId, s.marketId);

  const rate = (input: number, cached: number) =>
    input + cached === 0 ? 0 : cached / (input + cached);

  const perMarketAgg = new Map<string, { input: number; cached: number }>();
  let input = 0;
  let cached = 0;
  if (jobToMarket.size > 0) {
    const rows = await getDb()
      .select({
        jobId: usageLedger.jobId,
        inputTokens: usageLedger.inputTokens,
        cacheReadTokens: usageLedger.cacheReadTokens,
        workspaceId: usageLedger.workspaceId,
      })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.workspaceId, workspaceId),
          inArray(usageLedger.jobId, [...jobToMarket.keys()]),
        ),
      )
      .orderBy(asc(usageLedger.createdAt), desc(usageLedger.id));
    for (const row of rows) {
      const marketId = row.jobId ? jobToMarket.get(row.jobId) : undefined;
      if (!marketId) continue;
      const agg = perMarketAgg.get(marketId) ?? { input: 0, cached: 0 };
      agg.input += row.inputTokens;
      agg.cached += row.cacheReadTokens;
      perMarketAgg.set(marketId, agg);
      input += row.inputTokens;
      cached += row.cacheReadTokens;
    }
  }

  // Preserve market order as it appears in the step chain.
  const marketOrder = [...new Set(steps.map((s) => s.marketId))];
  return {
    overall: { inputTokens: input, cacheReadTokens: cached, hitRate: rate(input, cached) },
    perMarket: marketOrder.map((marketId) => {
      const agg = perMarketAgg.get(marketId) ?? { input: 0, cached: 0 };
      return {
        marketId,
        inputTokens: agg.input,
        cacheReadTokens: agg.cached,
        hitRate: rate(agg.input, agg.cached),
      };
    }),
  };
}

/** Latest build for a project (for the progress UI). */
export async function latestBuild(
  workspaceId: string,
  projectId: string,
): Promise<FunnelBuildRow | null> {
  const rows = await tenantDb(workspaceId).findMany(
    funnelBuilds,
    eq(funnelBuilds.projectId, projectId),
  );
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}
