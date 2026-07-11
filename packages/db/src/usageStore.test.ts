import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import {
  buildCostEstimate,
  DEFAULT_PER_ASSET_ESTIMATE,
  monthlyUsage,
  projectUsage,
  workspaceUsage,
} from './usageStore.js';
import { assets as assetsTable, markets, projects, usageLedger } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[usageStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('usage & cost dashboard (WO-053)', () => {
  it('ACCEPTANCE: dashboard sums reconcile with the ledger, per project and per stage', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const db = tenantDb(workspaceId);
    const p1 = await db.insert(projects, { name: 'Funnel A' });
    const p2 = await db.insert(projects, { name: 'Funnel B' });

    // A hand-seeded ledger with known exact sums.
    const rows = [
      { projectId: p1, stage: 'asset_drafting', input: 1000, cache: 4000, output: 2000, cost: '0.05' },
      { projectId: p1, stage: 'council', input: 500, cache: 1500, output: 300, cost: '0.02' },
      { projectId: p2, stage: 'asset_drafting', input: 2000, cache: 0, output: 1000, cost: '0.03' },
      { projectId: null, stage: null, input: 100, cache: 0, output: 50, cost: '0.001' },
    ];
    for (const r of rows) {
      await db.insert(usageLedger, {
        projectId: r.projectId,
        stage: r.stage,
        model: 'claude-test',
        inputTokens: r.input,
        cacheReadTokens: r.cache,
        outputTokens: r.output,
        costEstUsd: r.cost,
      });
    }

    const ws = await workspaceUsage(workspaceId);
    expect(ws.total.calls).toBe(4);
    expect(ws.total.inputTokens).toBe(3600);
    expect(ws.total.cacheReadTokens).toBe(5500);
    expect(ws.total.outputTokens).toBe(3350);
    expect(ws.total.costEstUsd).toBeCloseTo(0.101, 6);
    expect(ws.total.cacheHitRate).toBeCloseTo(5500 / (3600 + 5500), 6);

    // Per-project rows reconcile and cover every ledger row (incl. unattributed).
    const perProjectCost = ws.perProject.reduce((s, p) => s + p.usage.costEstUsd, 0);
    expect(perProjectCost).toBeCloseTo(ws.total.costEstUsd, 6);
    const a = ws.perProject.find((p) => p.projectId === p1)!;
    expect(a.usage).toMatchObject({ calls: 2, inputTokens: 1500, cacheReadTokens: 5500 });

    const proj = await projectUsage(workspaceId, p1);
    expect(proj.total.costEstUsd).toBeCloseTo(0.07, 6);
    expect(proj.perStage.map((s) => s.stage).sort()).toEqual(['asset_drafting', 'council']);
    expect(proj.perStage.reduce((s, x) => s + x.usage.calls, 0)).toBe(proj.total.calls);

    // Monthly: everything seeded now → exactly one month, equal to the total.
    const monthly = await monthlyUsage(workspaceId);
    expect(monthly).toHaveLength(1);
    expect(monthly[0]!.month).toBe(new Date().toISOString().slice(0, 7));
    expect(monthly[0]!.usage.costEstUsd).toBeCloseTo(ws.total.costEstUsd, 6);
  });

  it('pre-build estimate: documented defaults with no history, observed averages with it', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const db = tenantDb(workspaceId);

    const fresh = await buildCostEstimate(workspaceId, { marketCount: 5, assetTypeCount: 8 });
    expect(fresh.basis).toBe('defaults');
    expect(fresh.plannedAssets).toBe(40);
    expect(fresh.totalCostUsd).toBeCloseTo(DEFAULT_PER_ASSET_ESTIMATE.costUsd * 40, 6);

    // History: 2 built assets that cost $0.10 of stage-attributed usage total.
    const projectId = await db.insert(projects, { name: 'P' });
    const marketId = await db.insert(markets, {
      projectId, rank: 1, label: 'M', schemaVersion: '1', profile: {},
    });
    for (let i = 0; i < 2; i++) {
      await db.insert(assetsTable, { projectId, marketId, type: 'vsl' });
    }
    await db.insert(usageLedger, {
      projectId, stage: 'asset_drafting', model: 'm', inputTokens: 10, cacheReadTokens: 0,
      outputTokens: 1000, costEstUsd: '0.06',
    });
    await db.insert(usageLedger, {
      projectId, stage: 'council', model: 'm', inputTokens: 10, cacheReadTokens: 0,
      outputTokens: 500, costEstUsd: '0.04',
    });

    const informed = await buildCostEstimate(workspaceId, { marketCount: 2, assetTypeCount: 3 });
    expect(informed.basis).toBe('workspace-history');
    expect(informed.perAssetCostUsd).toBeCloseTo(0.05, 6); // $0.10 / 2 assets
    expect(informed.totalCostUsd).toBeCloseTo(0.3, 6); // × 6 planned
    expect(informed.perAssetOutputTokens).toBe(750);
  });
});
