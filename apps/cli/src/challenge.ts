import { and, asc, eq, inArray } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import type { ClientOptions } from '@copyforge/ai';
import {
  armMetrics,
  getDb,
  listControls,
  listMarkets,
  projectGateGrid,
  resolveProjectById,
  enqueueJob,
  jobs,
  type ClaimedJob,
} from '@copyforge/db';
import {
  createChallengerGenerateHandler,
  createComplianceHandler,
  createCouncilJobHandler,
  createDeslopHandler,
  createFocusGroupHandler,
  createPackageHandler,
  ASSET_COMPLIANCE_JOB,
  ASSET_COUNCIL_JOB,
  ASSET_DESLOP_JOB,
  ASSET_FOCUS_GROUP_JOB,
  ASSET_PACKAGE_JOB,
  CHALLENGER_GENERATE_JOB,
} from '@copyforge/pipeline';
import { JOB_TYPES } from '@copyforge/core';

/**
 * Headless challenge phase (WO-049): `produce --project <id> --phase challenge
 * [--target vsl@market2] [--limit 3]`. Reads the ledger's weak points (controls
 * ranked by observed CVR), generates a challenger per selected control through
 * the FULL gate ladder inline (G3 council → G4 focus → G5 de-slop → G6
 * compliance → G7 package), and emits a JSON summary. Challengers land with
 * lifecycle status `queued` — promotion stays a human decision (WO-044).
 */

export interface ChallengePhaseOptions {
  projectId: string;
  /** e.g. "vsl@market2" — narrows to one asset type + market rank. */
  target?: string;
  /** Max controls to challenge when untargeted (default 3). */
  limit?: number;
  /** Safety valve for the inline drain loop. */
  maxJobs?: number;
}

export interface ChallengePhaseDeps {
  clientOptions?: ClientOptions;
  log?: (line: string) => void;
}

export interface WeakPoint {
  controlId: string;
  assetId: string;
  assetType: string;
  marketRank: number | null;
  visitors: number;
  conversions: number;
  /** null when the control has no traffic yet. */
  cvr: number | null;
  selected: boolean;
  note: string;
}

/** Stable summary schema (WO-049 acceptance) — additive changes only. */
export interface ChallengePhaseSummary {
  ok: boolean;
  projectId: string;
  target: string | null;
  weakPoints: WeakPoint[];
  challengers: Array<{
    challengerId: string;
    controlId: string;
    assetId: string;
    status: string;
    assetStatus: string;
    gates: Record<'G3' | 'G4' | 'G5' | 'G6' | 'G7', 'pass' | 'fail' | 'override' | null>;
  }>;
  jobs: { processed: number; failed: number };
  error?: string;
}

export function parseTarget(target: string): { assetType: string; marketRank: number } {
  const match = /^([a-z_]+)@market([1-5])$/.exec(target.trim());
  if (!match) throw new Error(`--target must look like "vsl@market2" (got "${target}").`);
  return { assetType: match[1]!, marketRank: Number(match[2]) };
}

export async function runChallengePhase(
  opts: ChallengePhaseOptions,
  deps: ChallengePhaseDeps = {},
): Promise<ChallengePhaseSummary> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const base: ChallengePhaseSummary = {
    ok: false,
    projectId: opts.projectId,
    target: opts.target ?? null,
    weakPoints: [],
    challengers: [],
    jobs: { processed: 0, failed: 0 },
  };

  const project = await resolveProjectById(opts.projectId);
  if (!project) return { ...base, error: 'Project not found.' };
  const workspaceId = project.workspaceId;

  let target: { assetType: string; marketRank: number } | null = null;
  if (opts.target) {
    try {
      target = parseTarget(opts.target);
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // --- Read the ledger's weak points -------------------------------------------
  const [controlRows, markets] = await Promise.all([
    listControls(workspaceId, opts.projectId),
    listMarkets(workspaceId, opts.projectId),
  ]);
  const rankOf = new Map(markets.map((m) => [m.id, m.rank]));

  const weakPoints: WeakPoint[] = [];
  for (const { control } of controlRows) {
    const metrics = await armMetrics(workspaceId, control.assetId);
    weakPoints.push({
      controlId: control.id,
      assetId: control.assetId,
      assetType: control.assetType,
      marketRank: rankOf.get(control.marketId) ?? null,
      visitors: metrics.visitors,
      conversions: metrics.conversions,
      cvr: metrics.visitors > 0 ? metrics.conversions / metrics.visitors : null,
      selected: false,
      note: '',
    });
  }

  if (target) {
    for (const wp of weakPoints) {
      if (wp.assetType === target.assetType && wp.marketRank === target.marketRank) {
        wp.selected = true;
        wp.note = 'targeted';
      } else {
        wp.note = 'outside --target';
      }
    }
  } else {
    // Weakest observed CVR first; no-traffic controls carry no evidence.
    const limit = opts.limit ?? 3;
    const ranked = weakPoints
      .filter((wp) => wp.cvr !== null)
      .sort((a, b) => a.cvr! - b.cvr! || a.controlId.localeCompare(b.controlId));
    for (const wp of ranked.slice(0, limit)) {
      wp.selected = true;
      wp.note = 'weakest observed CVR';
    }
    for (const wp of weakPoints.filter((w) => !w.selected)) {
      wp.note = wp.cvr === null ? 'no traffic evidence yet' : 'above the weakness cutoff';
    }
  }

  const selected = weakPoints.filter((wp) => wp.selected);
  if (selected.length === 0) {
    return {
      ...base,
      weakPoints,
      error: target
        ? `No control matches --target ${opts.target}.`
        : 'No controls with ledger traffic to challenge.',
    };
  }
  log(`[challenge] ${selected.length} weak point(s) selected of ${weakPoints.length} control(s)`);

  // Snapshot pre-existing challengers so the summary reports only this run's.
  const preExisting = new Set(controlRows.flatMap((r) => r.challengers.map((c) => c.id)));

  for (const wp of selected) {
    await enqueueJob({
      workspaceId,
      type: JOB_TYPES.challengerGenerate,
      payload: { controlId: wp.controlId },
    });
  }

  // --- Drain this workspace's queue inline (same handlers as the worker) -------
  const co = deps.clientOptions ?? {};
  const handlers: Record<string, (job: ClaimedJob) => Promise<void>> = {
    [CHALLENGER_GENERATE_JOB]: createChallengerGenerateHandler(co),
    [ASSET_COUNCIL_JOB]: createCouncilJobHandler(co),
    [ASSET_FOCUS_GROUP_JOB]: createFocusGroupHandler(co),
    [ASSET_DESLOP_JOB]: createDeslopHandler(co),
    [ASSET_COMPLIANCE_JOB]: createComplianceHandler(),
    [ASSET_PACKAGE_JOB]: createPackageHandler(),
  };
  const handled = Object.keys(handlers);
  const maxJobs = opts.maxJobs ?? 500;
  let processed = 0;
  let failed = 0;
  while (processed < maxJobs) {
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, 'pending'), inArray(jobs.type, handled)),
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
      log(`[challenge] ✓ ${row.type}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await getDb().update(jobs).set({ status: 'failed', lastError: { message } }).where(eq(jobs.id, row.id));
      log(`[challenge] ✕ ${row.type}: ${message}`);
    }
    processed++;
  }

  // --- Summary: this run's challengers with their gate outcomes ----------------
  const [after, grid] = await Promise.all([
    listControls(workspaceId, opts.projectId),
    projectGateGrid(workspaceId, opts.projectId),
  ]);
  const gridByAsset = new Map(grid.map((r) => [r.assetId, r]));
  const selectedControls = new Set(selected.map((wp) => wp.controlId));

  const challengers = after
    .filter((r) => selectedControls.has(r.control.id))
    .flatMap((r) =>
      r.challengers
        .filter((c) => !preExisting.has(c.id))
        .map((c) => {
          const cell = gridByAsset.get(c.assetId);
          return {
            challengerId: c.id,
            controlId: r.control.id,
            assetId: c.assetId,
            status: c.status,
            assetStatus: cell?.status ?? 'unknown',
            gates: Object.fromEntries(
              (['G3', 'G4', 'G5', 'G6', 'G7'] as const).map((g) => {
                const gate = cell?.gates[g] ?? null;
                return [g, gate === null ? null : gate.overridden ? 'override' : gate.pass ? 'pass' : 'fail'];
              }),
            ) as ChallengePhaseSummary['challengers'][number]['gates'],
          };
        }),
    );

  const ok =
    failed === 0 &&
    challengers.length >= selected.length &&
    challengers.every((c) => c.status === 'queued' && c.assetStatus !== 'blocked');

  return {
    ok,
    projectId: opts.projectId,
    target: opts.target ?? null,
    weakPoints,
    challengers,
    jobs: { processed, failed },
  };
}
