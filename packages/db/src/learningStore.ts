import { and, eq, gte, inArray } from 'drizzle-orm';
import { JOB_TYPES, newId } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { enqueueJob } from './queue.js';
import { hasGenomeFeedEntitlement } from './harvest.js';
import {
  assets as assetsTable,
  challengers,
  genomeComponents,
  genomePacks,
  jobs,
  predictions,
  swipes,
  workspaces,
} from './schema/index.js';

/**
 * Learning loop support (WO-048). Deterministic winner selection, the
 * internal-winner idempotency ledger (a tagged workspace-layer swipe per
 * asset), Genome Feed pack refresh, and the nightly enqueue gate.
 *
 * Internal winners live on the WORKSPACE genome layer (workspace_id set) —
 * the shared/own read scope in genome.ts makes cross-workspace leakage
 * structurally impossible.
 */

/** "High Brier accuracy": within ten points of the observed rate. */
export const BRIER_ACCURACY_MAX = 0.01;

export interface LearningWinner {
  assetId: string;
  reason: 'promoted' | 'brier_accuracy';
  brier?: number;
}

/** Promoted challengers + high-Brier-accuracy assets, deduped, stable order. */
export async function findLearningWinners(workspaceId: string): Promise<LearningWinner[]> {
  const db = tenantDb(workspaceId);
  const byAsset = new Map<string, LearningWinner>();

  for (const row of await db.findMany(challengers, eq(challengers.status, 'won'))) {
    byAsset.set(row.assetId, { assetId: row.assetId, reason: 'promoted' });
  }

  const resolved = (await db.findMany(predictions, undefined)).filter(
    (p) => p.resolvedAt !== null && p.brier !== null && Number(p.brier) <= BRIER_ACCURACY_MAX,
  );
  if (resolved.length > 0) {
    // Only real assets decompose (quiz forecasts key their definition id).
    const assetRows = await db.findMany(
      assetsTable,
      inArray(assetsTable.id, resolved.map((p) => p.assetId)),
    );
    const realAssets = new Set(assetRows.map((a) => a.id));
    for (const p of resolved) {
      if (!realAssets.has(p.assetId) || byAsset.has(p.assetId)) continue;
      byAsset.set(p.assetId, { assetId: p.assetId, reason: 'brier_accuracy', brier: Number(p.brier) });
    }
  }

  return [...byAsset.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
}

export const internalWinnerTag = (assetId: string): string => `asset:${assetId}`;

/** The winner's decomposition ledger entry: its workspace-layer swipe, if any. */
export async function findInternalWinnerSwipe(workspaceId: string, assetId: string) {
  const tag = internalWinnerTag(assetId);
  const rows = await getDb().select().from(swipes).where(eq(swipes.workspaceId, workspaceId));
  return rows.find((r) => (r.tags ?? []).includes(tag)) ?? null;
}

export async function countComponentsForSwipe(swipeId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: genomeComponents.id })
    .from(genomeComponents)
    .where(eq(genomeComponents.swipeId, swipeId));
  return rows.length;
}

/**
 * Refresh the workspace's Genome Feed packs from its internal winners —
 * entitled workspaces only (everyone keeps the private components either
 * way; the curated pack is the subscription product). Upserts one pack per
 * niche, so re-runs update in place. Returns packs refreshed.
 */
export async function refreshGenomeFeedPacks(workspaceId: string): Promise<number> {
  if (!(await hasGenomeFeedEntitlement(workspaceId))) return 0;

  const winners = await getDb()
    .select()
    .from(genomeComponents)
    .where(
      and(eq(genomeComponents.workspaceId, workspaceId), eq(genomeComponents.isInternalWinner, true)),
    );
  const byNiche = new Map<string, string[]>();
  for (const c of winners) {
    const niche = c.niche ?? 'internal';
    byNiche.set(niche, [...(byNiche.get(niche) ?? []), c.id]);
  }

  let refreshed = 0;
  for (const [niche, ids] of [...byNiche.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const name = `Genome Feed — ${niche}`;
    const definition = {
      componentIds: [...ids].sort(),
      source: 'learning.nightly',
      internalWinners: true,
    };
    const existing = await getDb()
      .select()
      .from(genomePacks)
      .where(
        and(
          eq(genomePacks.workspaceId, workspaceId),
          eq(genomePacks.niche, niche),
          eq(genomePacks.name, name),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await getDb().update(genomePacks).set({ definition }).where(eq(genomePacks.id, existing[0].id));
    } else {
      await getDb().insert(genomePacks).values({
        id: newId(),
        workspaceId,
        niche,
        name,
        definition,
      });
    }
    refreshed++;
  }
  return refreshed;
}

/**
 * Nightly enqueue gate: after `hourUtc`, give every workspace exactly one
 * `learning.nightly` job per UTC day. Idempotent — a same-day job (any
 * status) blocks re-enqueue. `workspaceIds` narrows the sweep for tests.
 */
export async function enqueueDueNightlyLearning(opts?: {
  hourUtc?: number;
  now?: Date;
  workspaceIds?: string[];
}): Promise<number> {
  const hourUtc = opts?.hourUtc ?? 3;
  const now = opts?.now ?? new Date();
  if (now.getUTCHours() < hourUtc) return 0;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const wsRows = opts?.workspaceIds
    ? await getDb().select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.id, opts.workspaceIds))
    : await getDb().select({ id: workspaces.id }).from(workspaces);

  let enqueued = 0;
  for (const ws of wsRows) {
    const existing = await getDb()
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, ws.id),
          eq(jobs.type, JOB_TYPES.learningNightly),
          gte(jobs.createdAt, dayStart),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    await enqueueJob({ workspaceId: ws.id, type: JOB_TYPES.learningNightly, payload: {} });
    enqueued++;
  }
  return enqueued;
}
