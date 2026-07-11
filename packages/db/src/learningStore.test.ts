import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, JOB_TYPES } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { insertGenomeComponents, listGenomePacks, queryGenomeComponents } from './genome.js';
import { addSwipe } from './genome.js';
import {
  BRIER_ACCURACY_MAX,
  enqueueDueNightlyLearning,
  findLearningWinners,
  refreshGenomeFeedPacks,
} from './learningStore.js';
import {
  assets as assetsTable,
  challengers,
  controls,
  jobs,
  markets,
  predictions,
  projects,
  subscriptions,
  workspaces,
} from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[learningStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup() {
  const workspaceId = newId();
  const db = tenantDb(workspaceId);
  const projectId = await db.insert(projects, { name: 'Learning test' });
  const marketId = await db.insert(markets, {
    projectId, rank: 1, label: 'M1', schemaVersion: '1', profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, marketId };
}

describe('learning loop store (WO-048)', () => {
  it('winners = promoted challengers + high-Brier-accuracy assets, deduped', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const db = tenantDb(workspaceId);

    const control = await db.insert(assetsTable, { projectId, marketId, type: 'vsl' });
    const promoted = await db.insert(assetsTable, { projectId, marketId, type: 'vsl' });
    const accurate = await db.insert(assetsTable, { projectId, marketId, type: 'sales_letter' });
    const sloppy = await db.insert(assetsTable, { projectId, marketId, type: 'sales_letter' });

    const controlId = await db.insert(controls, { projectId, marketId, assetType: 'vsl', assetId: control });
    await db.insert(challengers, { controlId, assetId: promoted, status: 'won' });

    // Accurate forecast (brier at the threshold) + a badly-missed one + one on
    // the PROMOTED asset (must dedupe, promoted reason wins).
    await db.insert(predictions, {
      assetId: accurate, metric: 'letter_cvr', predicted: '0.02',
      actual: '0.02', brier: String(BRIER_ACCURACY_MAX), resolvedAt: new Date(),
    });
    await db.insert(predictions, {
      assetId: sloppy, metric: 'letter_cvr', predicted: '0.02',
      actual: '0.3', brier: '0.0784', resolvedAt: new Date(),
    });
    await db.insert(predictions, {
      assetId: promoted, metric: 'vsl_50_retention', predicted: '0.35',
      actual: '0.36', brier: '0.0001', resolvedAt: new Date(),
    });

    const winners = await findLearningWinners(workspaceId);
    expect(winners).toHaveLength(2);
    const byId = new Map(winners.map((w) => [w.assetId, w]));
    expect(byId.get(promoted)!.reason).toBe('promoted');
    expect(byId.get(accurate)!.reason).toBe('brier_accuracy');
    expect(byId.has(sloppy)).toBe(false);
    expect(byId.has(control)).toBe(false);
  });

  it('pack refresh: nothing without entitlement, upserts in place with it', async () => {
    if (!dbUp) return;
    const { workspaceId } = await setup();

    const swipeId = await addSwipe({ workspaceId, rawSource: 'winner copy', niche: 'garage', channel: 'internal' });
    await insertGenomeComponents({
      workspaceId, swipeId, niche: 'garage', channel: 'internal', awareness: 'problem',
      isInternalWinner: true,
      components: [{ type: 'lead', content: { summary: 's' }, confidence: 0.9, tags: [] }],
    });

    // ACCEPTANCE (fails closed): no entitlement → no pack.
    expect(await refreshGenomeFeedPacks(workspaceId)).toBe(0);
    expect((await listGenomePacks(workspaceId)).filter((p) => p.workspaceId === workspaceId)).toHaveLength(0);

    await tenantDb(workspaceId).insert(subscriptions, { status: 'active', genomeFeed: true });
    expect(await refreshGenomeFeedPacks(workspaceId)).toBe(1);
    // Re-run: same single pack, refreshed in place — no duplicates.
    expect(await refreshGenomeFeedPacks(workspaceId)).toBe(1);
    const packs = (await listGenomePacks(workspaceId, 'garage')).filter((p) => p.workspaceId === workspaceId);
    expect(packs).toHaveLength(1);
    expect(packs[0]!.name).toBe('Genome Feed — garage');
    expect((packs[0]!.definition as { componentIds: string[] }).componentIds).toHaveLength(1);
  });

  it('internal winners never leak into another workspace (fails closed)', async () => {
    if (!dbUp) return;
    const { workspaceId } = await setup();
    const stranger = newId();

    const swipeId = await addSwipe({ workspaceId, rawSource: 'private winner', niche: 'leaky-niche', channel: 'internal' });
    await insertGenomeComponents({
      workspaceId, swipeId, niche: 'leaky-niche', channel: 'internal', awareness: 'problem',
      isInternalWinner: true,
      components: [{ type: 'lead', content: { summary: 'secret' }, confidence: 0.9, tags: [] }],
    });

    const mine = await queryGenomeComponents({ workspaceId, niche: 'leaky-niche' });
    expect(mine).toHaveLength(1);
    const theirs = await queryGenomeComponents({ workspaceId: stranger, niche: 'leaky-niche' });
    expect(theirs).toHaveLength(0);
  });

  it('nightly enqueue: after the hour, one job per workspace per UTC day', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await getDb().insert(workspaces).values({ id: workspaceId, name: 'Nightly WS', ownerUserId: newId() });
    const scope = { workspaceIds: [workspaceId] };
    const at = (h: number) => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 30));
    };

    // Before the hour: nothing.
    expect(await enqueueDueNightlyLearning({ ...scope, hourUtc: 3, now: at(2) })).toBe(0);
    // After: exactly one; repeat sweeps stay quiet (idempotent per day).
    expect(await enqueueDueNightlyLearning({ ...scope, hourUtc: 3, now: at(4) })).toBe(1);
    expect(await enqueueDueNightlyLearning({ ...scope, hourUtc: 3, now: at(5) })).toBe(0);

    const rows = await getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, JOB_TYPES.learningNightly)));
    expect(rows).toHaveLength(1);
  });
});
