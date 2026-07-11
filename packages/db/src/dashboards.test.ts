import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { createAsset, setAssetStatus } from './assetsStore.js';
import { approveAsset } from './gatesDashboard.js';
import { recordEvent, type EventType } from './eventsStore.js';
import { resolvePredictions } from './predictionsStore.js';
import { assetRetentionCurve, brierTrend, funnelCsv, projectFunnel } from './dashboards.js';
import { markets, projects } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[dashboards.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup() {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Dashboard test' });
  const m1 = await tenantDb(workspaceId).insert(markets, {
    projectId, rank: 1, label: 'Broken spring', schemaVersion: '1', profile: { origin: 'engine' },
  });
  const m2 = await tenantDb(workspaceId).insert(markets, {
    projectId, rank: 2, label: 'Stuck door', schemaVersion: '1', profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, m1, m2 };
}

/** Seed n events of a type into a market (unique dedupe keys). */
async function seed(
  ctx: { workspaceId: string; projectId: string },
  marketId: string | null,
  type: EventType,
  n: number,
  extra: { assetId?: string; quartile?: number } = {},
) {
  for (let i = 0; i < n; i++) {
    await recordEvent({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      marketId,
      assetId: extra.assetId ?? null,
      type,
      value: extra.quartile ? { quartile: extra.quartile } : null,
      source: 'pixel',
      dedupeKey: `${type}:${marketId ?? 'none'}:${extra.quartile ?? 0}:${extra.assetId ?? ''}:${i}`,
    });
  }
}

describe('ledger dashboards (WO-046)', () => {
  it('renders the funnel per market from the fixture event stream, numbers exact', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, m1, m2 } = await setup();
    const ctx = { workspaceId, projectId };

    // Market 1: 100 views → 40 quiz starts → 30 completes → 20 optins →
    // retention 60/45/30/12 → 8 calls, 5 qualified, 3 sales, 1 refund.
    await seed(ctx, m1, 'page_view', 100);
    await seed(ctx, m1, 'quiz_start', 40);
    await seed(ctx, m1, 'quiz_complete', 30);
    await seed(ctx, m1, 'optin', 20);
    await seed(ctx, m1, 'vsl_quartile', 60, { quartile: 25 });
    await seed(ctx, m1, 'vsl_quartile', 45, { quartile: 50 });
    await seed(ctx, m1, 'vsl_quartile', 30, { quartile: 75 });
    await seed(ctx, m1, 'vsl_quartile', 12, { quartile: 95 });
    await seed(ctx, m1, 'call_start', 8);
    await seed(ctx, m1, 'call_qualified', 5);
    await seed(ctx, m1, 'sale', 3);
    await seed(ctx, m1, 'refund', 1);
    // Market 2: smaller stream; plus 5 unattributed views.
    await seed(ctx, m2, 'page_view', 50);
    await seed(ctx, m2, 'optin', 10);
    await seed(ctx, m2, 'sale', 1);
    await seed(ctx, null, 'page_view', 5);

    const { markets: rows, total } = await projectFunnel(workspaceId, projectId);
    expect(rows).toHaveLength(3); // m1, m2, unattributed(null) — null sorts first
    const f1 = rows.find((r) => r.marketId === m1)!;
    expect(f1).toMatchObject({
      pageViews: 100, quizStarts: 40, quizCompletes: 30, optins: 20,
      callsStarted: 8, callsQualified: 5, sales: 3, refunds: 1,
    });
    // Acceptance: retention curve matches the raw quartile events exactly.
    expect(f1.retention).toEqual({ starts: 100, q25: 60, q50: 45, q75: 30, q95: 12 });
    const f2 = rows.find((r) => r.marketId === m2)!;
    expect(f2).toMatchObject({ pageViews: 50, optins: 10, sales: 1, quizStarts: 0 });
    const unattributed = rows.find((r) => r.marketId === null)!;
    expect(unattributed.pageViews).toBe(5);
    expect(total.pageViews).toBe(155);
    expect(total.sales).toBe(4);
    expect(total.retention).toEqual({ starts: 155, q25: 60, q50: 45, q75: 30, q95: 12 });
  });

  it('asset retention curve counts equal the raw quartile events', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, m1 } = await setup();
    const ctx = { workspaceId, projectId };
    const assetId = await createAsset({ workspaceId, projectId, marketId: m1, type: 'vsl' });

    await seed(ctx, m1, 'page_view', 80, { assetId });
    await seed(ctx, m1, 'vsl_quartile', 48, { assetId, quartile: 25 });
    await seed(ctx, m1, 'vsl_quartile', 36, { assetId, quartile: 50 });
    await seed(ctx, m1, 'vsl_quartile', 21, { assetId, quartile: 75 });
    await seed(ctx, m1, 'vsl_quartile', 9, { assetId, quartile: 95 });
    // Another asset's events must not bleed in.
    const other = await createAsset({ workspaceId, projectId, marketId: m1, type: 'vsl' });
    await seed(ctx, m1, 'vsl_quartile', 7, { assetId: other, quartile: 50 });

    expect(await assetRetentionCurve(workspaceId, assetId)).toEqual({
      starts: 80, q25: 48, q50: 36, q75: 21, q95: 9,
    });
  });

  it('brier trend runs in resolution order with a running mean; CSV is exact', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, m1 } = await setup();
    const ctx = { workspaceId, projectId };

    // An approved VSL records a forecast (0.35); 100 starts with 60 at q50 → brier (0.35-0.6)².
    const assetId = await createAsset({ workspaceId, projectId, marketId: m1, type: 'vsl' });
    for (const s of ['council', 'focus_group', 'deslop', 'compliance', 'packaging'] as const) {
      await setAssetStatus(workspaceId, assetId, s);
    }
    await approveAsset({ workspaceId, assetId, actorUserId: newId() });
    await seed(ctx, m1, 'page_view', 100, { assetId });
    await seed(ctx, m1, 'vsl_quartile', 60, { assetId, quartile: 50 });
    await resolvePredictions(workspaceId);

    const trend = await brierTrend(workspaceId, projectId);
    expect(trend).toHaveLength(1);
    expect(trend[0]!.metric).toBe('vsl_50_retention');
    expect(trend[0]!.brier).toBeCloseTo((0.35 - 0.6) ** 2, 5);
    expect(trend[0]!.runningMean).toBeCloseTo(trend[0]!.brier, 5);

    const funnel = await projectFunnel(workspaceId, projectId);
    const csv = funnelCsv(funnel, new Map([[m1, '1. Broken spring']]));
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'market,page_views,quiz_starts,quiz_completes,optins,calls_started,calls_qualified,sales,refunds,retention_q25,retention_q50,retention_q75,retention_q95',
    );
    expect(lines).toContain('1. Broken spring,100,0,0,0,0,0,0,0,0,60,0,0');
    expect(lines.at(-1)).toBe('TOTAL,100,0,0,0,0,0,0,0,0,60,0,0');
  });
});
