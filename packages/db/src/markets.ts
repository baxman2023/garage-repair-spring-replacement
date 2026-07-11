import { eq } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { withTxRetry } from './txRetry.js';
import { markets, projects } from './schema/index.js';

/**
 * Markets store (WO-012). Top 5 markets per project at ranks 1–5.
 *
 * Rows carry an `origin` marker inside their profile JSON:
 * - 'engine' — produced by the selection engine; replaced on re-runs.
 * - 'user'   — edited or manually added; SURVIVES re-runs (acceptance).
 */

export type MarketRow = typeof markets.$inferSelect;
export const MAX_MARKETS = 5;

interface MarketProfileSeed {
  origin: 'engine' | 'user';
  avatar_hint?: string;
  scores?: Record<string, number>;
  [key: string]: unknown;
}

async function assertProjectTx(
  tx: { select: ReturnType<typeof getDb>['select'] },
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const rows = await tx
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!rows[0] || rows[0].workspaceId !== workspaceId) {
    throw new Error('Project not found in this workspace.');
  }
}

export async function listMarkets(workspaceId: string, projectId: string): Promise<MarketRow[]> {
  const rows = await getDb().select().from(markets).where(eq(markets.projectId, projectId));
  return rows.filter((r) => r.workspaceId === workspaceId).sort((a, b) => a.rank - b.rank);
}

export interface EngineCandidate {
  label: string;
  rationale: string;
  total: number;
  profile: Record<string, unknown>;
}

/**
 * Apply a fresh engine run: engine-origin rows are replaced; user-origin rows
 * keep their ranks. New candidates (best first) fill the free ranks up to 5.
 */
export async function applyEngineCandidates(params: {
  workspaceId: string;
  projectId: string;
  candidates: EngineCandidate[];
}): Promise<void> {
  const db = getDb();
  await withTxRetry(() =>
    db.transaction(async (tx) => {
      await assertProjectTx(tx, params.workspaceId, params.projectId);
      const existing = (
        await tx.select().from(markets).where(eq(markets.projectId, params.projectId))
      ).filter((r) => r.workspaceId === params.workspaceId);

      const userRows = existing.filter(
        (r) => (r.profile as MarketProfileSeed | null)?.origin === 'user',
      );
      const engineRows = existing.filter(
        (r) => (r.profile as MarketProfileSeed | null)?.origin !== 'user',
      );
      for (const row of engineRows) {
        await tx.delete(markets).where(eq(markets.id, row.id));
      }

      const takenRanks = new Set(userRows.map((r) => r.rank));
      const userLabels = new Set(userRows.map((r) => r.label.trim().toLowerCase()));
      const freeRanks = [1, 2, 3, 4, 5].filter((r) => !takenRanks.has(r));

      const fresh = params.candidates.filter(
        (c) => !userLabels.has(c.label.trim().toLowerCase()),
      );
      for (let i = 0; i < freeRanks.length && i < fresh.length; i++) {
        const c = fresh[i]!;
        await tx.insert(markets).values({
          id: newId(),
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          rank: freeRanks[i]!,
          label: c.label,
          schemaVersion: '1',
          profile: { ...c.profile, origin: 'engine' },
          scoreTotal: c.total.toFixed(3),
          rationale: c.rationale,
        });
      }
    }),
  );
}

/** Swap the ranks of two markets. */
export async function swapMarketRanks(params: {
  workspaceId: string;
  projectId: string;
  marketIdA: string;
  marketIdB: string;
}): Promise<void> {
  const db = getDb();
  await withTxRetry(() =>
    db.transaction(async (tx) => {
      await assertProjectTx(tx, params.workspaceId, params.projectId);
      const rows = (
        await tx.select().from(markets).where(eq(markets.projectId, params.projectId))
      ).filter((r) => r.workspaceId === params.workspaceId);
      const a = rows.find((r) => r.id === params.marketIdA);
      const b = rows.find((r) => r.id === params.marketIdB);
      if (!a || !b) throw new Error('Market not found in this project.');
      // Two-phase swap to avoid any transient unique collisions.
      await tx.update(markets).set({ rank: -1 }).where(eq(markets.id, a.id));
      await tx.update(markets).set({ rank: a.rank }).where(eq(markets.id, b.id));
      await tx.update(markets).set({ rank: b.rank }).where(eq(markets.id, a.id));
    }),
  );
}

/** Edit a market (label/rationale/profile patch). Marks it user-origin. */
export async function updateMarket(params: {
  workspaceId: string;
  projectId: string;
  marketId: string;
  label?: string;
  rationale?: string;
  profilePatch?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await withTxRetry(() =>
    db.transaction(async (tx) => {
      await assertProjectTx(tx, params.workspaceId, params.projectId);
      const rows = await tx.select().from(markets).where(eq(markets.id, params.marketId)).limit(1);
      const row = rows[0];
      if (!row || row.workspaceId !== params.workspaceId || row.projectId !== params.projectId) {
        throw new Error('Market not found in this project.');
      }
      const profile = {
        ...(row.profile as Record<string, unknown>),
        ...(params.profilePatch ?? {}),
        // Keep the profile JSON's label in lockstep with the row label so
        // snapshot hashes (G2) see row-level renames.
        ...(params.label !== undefined ? { label: params.label } : {}),
        origin: 'user' as const,
      };
      await tx
        .update(markets)
        .set({
          label: params.label ?? row.label,
          rationale: params.rationale ?? row.rationale,
          profile,
        })
        .where(eq(markets.id, row.id));
    }),
  );
}

/**
 * Persist a full market_profile.json for a market (WO-013). Merges over the
 * existing profile JSON, preserving the `origin` marker (user edits still
 * survive re-runs) and mirrors the diagnosis into the dedicated columns.
 */
export async function applyMarketProfile(params: {
  workspaceId: string;
  projectId: string;
  marketId: string;
  profile: Record<string, unknown> & {
    awareness_stage: 'unaware' | 'problem' | 'solution' | 'product' | 'most';
    sophistication: number;
    resident_emotion: string;
  };
}): Promise<void> {
  const db = getDb();
  await withTxRetry(() =>
    db.transaction(async (tx) => {
      await assertProjectTx(tx, params.workspaceId, params.projectId);
      const rows = await tx.select().from(markets).where(eq(markets.id, params.marketId)).limit(1);
      const row = rows[0];
      if (!row || row.workspaceId !== params.workspaceId || row.projectId !== params.projectId) {
        throw new Error('Market not found in this project.');
      }
      const existing = (row.profile ?? {}) as MarketProfileSeed;
      await tx
        .update(markets)
        .set({
          profile: { ...existing, ...params.profile, origin: existing.origin ?? 'engine' },
          awarenessStage: params.profile.awareness_stage,
          sophistication: params.profile.sophistication,
          residentEmotion: params.profile.resident_emotion,
        })
        .where(eq(markets.id, row.id));
    }),
  );
}

/**
 * Add a manual market. Takes the lowest free rank; if all 5 are taken it
 * replaces the lowest-ranked ENGINE row, and refuses when all five are
 * user-origin (the user must edit/remove one instead).
 */
export async function addManualMarket(params: {
  workspaceId: string;
  projectId: string;
  label: string;
  rationale: string;
}): Promise<string> {
  const db = getDb();
  return withTxRetry(() =>
    db.transaction(async (tx) => {
      await assertProjectTx(tx, params.workspaceId, params.projectId);
      const rows = (
        await tx.select().from(markets).where(eq(markets.projectId, params.projectId))
      ).filter((r) => r.workspaceId === params.workspaceId);

      let rank: number;
      const taken = new Set(rows.map((r) => r.rank));
      const free = [1, 2, 3, 4, 5].filter((r) => !taken.has(r));
      if (free.length > 0) {
        rank = free[0]!;
      } else {
        const engineRows = rows
          .filter((r) => (r.profile as MarketProfileSeed | null)?.origin !== 'user')
          .sort((a, b) => b.rank - a.rank);
        const victim = engineRows[0];
        if (!victim) {
          throw new Error('All five market slots are user-defined — edit or remove one first.');
        }
        await tx.delete(markets).where(eq(markets.id, victim.id));
        rank = victim.rank;
      }

      const id = newId();
      await tx.insert(markets).values({
        id,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        rank,
        label: params.label,
        schemaVersion: '1',
        profile: { origin: 'user' },
        scoreTotal: null,
        rationale: params.rationale,
      });
      return id;
    }),
  );
}
