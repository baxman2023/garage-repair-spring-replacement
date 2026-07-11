import { and, asc, eq, inArray } from 'drizzle-orm';
import { newId, type FunnelAssetType } from '@copyforge/core';
import type { ClientOptions } from '@copyforge/ai';
import {
  getBuild,
  getDb,
  listBuildSteps,
  listMarkets,
  projectGateGrid,
  resolveProjectById,
  startFunnelBuild,
  jobs,
  type ClaimedJob,
} from '@copyforge/db';
import {
  createBuildStepHandler,
  createComplianceHandler,
  createCouncilJobHandler,
  createDeslopHandler,
  createFocusGroupHandler,
  createGenerateHandler,
  ASSET_COMPLIANCE_JOB,
  ASSET_COUNCIL_JOB,
  ASSET_DESLOP_JOB,
  ASSET_FOCUS_GROUP_JOB,
  ASSET_GENERATE_JOB,
  BUILD_STEP_JOB,
} from '@copyforge/pipeline';

/**
 * Headless build phase (WO-034): `produce --project <id> --phase build
 * [--markets 1,2] [--assets vsl,email_sequence]`. Starts the fan-out build
 * (post-G2) and drains THIS workspace's job queue inline — build steps,
 * generation, and every follow-on gate (G3 council → G4 focus group → G5
 * de-slop → G6 compliance) — streaming progress, then emits the JSON summary
 * with per-asset gate outcomes. Non-zero exit on any blocked asset.
 */

export interface BuildPhaseOptions {
  projectId: string;
  /** Market ranks 1–5; default all. */
  markets?: number[];
  /** Asset-type subset; default the full funnel sequence. */
  assets?: FunnelAssetType[];
  /** Safety valve for the inline drain loop. */
  maxJobs?: number;
}

export interface BuildPhaseDeps {
  clientOptions?: ClientOptions;
  /** Progress stream (default stderr). */
  log?: (line: string) => void;
}

/** Stable summary schema (WO-034 acceptance) — additive changes only. */
export interface BuildPhaseSummary {
  ok: boolean;
  projectId: string;
  buildId: string | null;
  build: { status: string; steps: Array<{ seq: number; marketRank: number | null; assetType: string; status: string; error: string | null }> } | null;
  assets: Array<{
    assetId: string;
    type: string;
    marketRank: number | null;
    status: string;
    gates: Record<'G3' | 'G4' | 'G5' | 'G6' | 'G7', 'pass' | 'fail' | 'override' | null>;
  }>;
  /** Asset ids that ended blocked (drives the non-zero exit). */
  blocked: string[];
  jobs: { processed: number; failed: number };
  error?: string;
}

export async function runBuildPhase(
  opts: BuildPhaseOptions,
  deps: BuildPhaseDeps = {},
): Promise<BuildPhaseSummary> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const base: BuildPhaseSummary = {
    ok: false,
    projectId: opts.projectId,
    buildId: null,
    build: null,
    assets: [],
    blocked: [],
    jobs: { processed: 0, failed: 0 },
  };

  const project = await resolveProjectById(opts.projectId);
  if (!project) return { ...base, error: 'Project not found.' };
  const workspaceId = project.workspaceId;

  // The inline handler registry — the same handlers the worker runs.
  const co = deps.clientOptions ?? {};
  const handlers: Record<string, (job: ClaimedJob) => Promise<void>> = {
    [BUILD_STEP_JOB]: createBuildStepHandler(co),
    [ASSET_GENERATE_JOB]: createGenerateHandler(co),
    [ASSET_COUNCIL_JOB]: createCouncilJobHandler(co),
    [ASSET_FOCUS_GROUP_JOB]: createFocusGroupHandler(co),
    [ASSET_DESLOP_JOB]: createDeslopHandler(co),
    [ASSET_COMPLIANCE_JOB]: createComplianceHandler(),
  };

  let buildId: string;
  try {
    buildId = await startFunnelBuild({
      workspaceId,
      projectId: opts.projectId,
      marketRanks: opts.markets,
      assetTypes: opts.assets,
    });
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
  log(`[build] started ${buildId}`);

  // Drain THIS workspace's queue inline (headless — no worker process).
  const maxJobs = opts.maxJobs ?? 2000;
  let processed = 0;
  let failed = 0;
  const handled = Object.keys(handlers);
  while (processed < maxJobs) {
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, workspaceId),
          eq(jobs.status, 'pending'),
          inArray(jobs.type, handled),
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.id))
      .limit(1);
    const row = rows[0];
    if (!row) break;

    const claimed: ClaimedJob = {
      id: row.id,
      workspaceId,
      type: row.type,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      attempts: row.attempts + 1,
      jobRunId: newId(),
    };
    try {
      await handlers[row.type]!(claimed);
      await getDb().update(jobs).set({ status: 'done' }).where(eq(jobs.id, row.id));
      log(`[build] ✓ ${row.type} (${describe(claimed)})`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await getDb()
        .update(jobs)
        .set({ status: 'failed', lastError: { message } })
        .where(eq(jobs.id, row.id));
      log(`[build] ✕ ${row.type} (${describe(claimed)}): ${message}`);
    }
    processed++;
  }

  // Summary: build steps + per-asset gate outcomes.
  const [build, steps, grid, markets] = await Promise.all([
    getBuild(workspaceId, buildId),
    listBuildSteps(workspaceId, buildId),
    projectGateGrid(workspaceId, opts.projectId),
    listMarkets(workspaceId, opts.projectId),
  ]);
  const rankOf = new Map(markets.map((m) => [m.id, m.rank]));
  const builtAssetIds = new Set(steps.flatMap((s) => s.assetIds ?? []));

  const assets = grid
    .filter((r) => builtAssetIds.has(r.assetId))
    .map((r) => ({
      assetId: r.assetId,
      type: r.assetType,
      marketRank: r.marketId ? (rankOf.get(r.marketId) ?? null) : null,
      status: r.status,
      gates: Object.fromEntries(
        (['G3', 'G4', 'G5', 'G6', 'G7'] as const).map((g) => {
          const cell = r.gates[g];
          return [g, cell === null ? null : cell.overridden ? 'override' : cell.pass ? 'pass' : 'fail'];
        }),
      ) as BuildPhaseSummary['assets'][number]['gates'],
    }));

  const blocked = assets.filter((a) => a.status === 'blocked').map((a) => a.assetId);
  const ok = build?.status === 'done' && failed === 0 && blocked.length === 0;

  return {
    ok,
    projectId: opts.projectId,
    buildId,
    build: build
      ? {
          status: build.status,
          steps: steps.map((s) => ({
            seq: s.seq,
            marketRank: rankOf.get(s.marketId) ?? null,
            assetType: s.assetType,
            status: s.status,
            error: s.error,
          })),
        }
      : null,
    assets,
    blocked,
    jobs: { processed, failed },
  };
}

function describe(job: ClaimedJob): string {
  const p = job.payload;
  if (typeof p.assetId === 'string') return `asset ${p.assetId.slice(-8)}`;
  if (typeof p.seq === 'number' || typeof p.seq === 'string') return `step ${p.seq}`;
  return job.id.slice(-8);
}
