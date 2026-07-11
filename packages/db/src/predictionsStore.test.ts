import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, BASE_PRIORS, PRIOR_FACTOR_MAX } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { createAsset, setAssetStatus } from './assetsStore.js';
import { approveAsset } from './gatesDashboard.js';
import { recordEvent } from './eventsStore.js';
import {
  getCalibration,
  listPredictionsForProject,
  metricActual,
  recordPredictionAtApproval,
  resolvePredictions,
  runCalibration,
} from './predictionsStore.js';
import { markets, predictions, projects } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[predictionsStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Predictions test' });
  const marketId = await tenantDb(workspaceId).insert(markets, {
    projectId, rank: 1, label: 'M1', schemaVersion: '1', profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, marketId };
}

async function approvedVsl(workspaceId: string, projectId: string, marketId: string): Promise<string> {
  const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  for (const s of ['council', 'focus_group', 'deslop', 'compliance', 'packaging'] as const) {
    await setAssetStatus(workspaceId, assetId, s);
  }
  await approveAsset({ workspaceId, assetId, actorUserId: newId() });
  return assetId;
}

/** Seed VSL traffic: starts (page_view) and 50%-quartile reaches. */
async function seedVslTraffic(workspaceId: string, projectId: string, assetId: string, starts: number, reached50: number) {
  for (let i = 0; i < starts; i++) {
    await recordEvent({
      workspaceId, projectId, assetId, type: 'page_view', source: 'pixel',
      sessionRef: `v-${i}`, dedupeKey: `pv:${assetId}:${i}`,
    });
  }
  for (let i = 0; i < reached50; i++) {
    await recordEvent({
      workspaceId, projectId, assetId, type: 'vsl_quartile', value: { quartile: 50 }, source: 'pixel',
      sessionRef: `v-${i}`, dedupeKey: `q50:${assetId}:${i}`,
    });
  }
}

describe('predictions & Brier (WO-045)', () => {
  it('approval records the forecast with its band; never duplicates', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const assetId = await approvedVsl(workspaceId, projectId, marketId);

    const rows = await tenantDb(workspaceId).findMany(predictions, eq(predictions.assetId, assetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metric).toBe('vsl_50_retention');
    expect(Number(rows[0]!.predicted)).toBeCloseTo(BASE_PRIORS.vsl_50_retention.prior, 5);
    expect(rows[0]!.band).toEqual(BASE_PRIORS.vsl_50_retention.band);
    expect(rows[0]!.resolvedAt).toBeNull();

    // Re-recording is a no-op.
    expect(await recordPredictionAtApproval({ workspaceId, assetId })).toBeNull();
    expect(await tenantDb(workspaceId).findMany(predictions, eq(predictions.assetId, assetId))).toHaveLength(1);
  });

  it('the resolver waits for volume, then scores with Brier; display pairs prediction and actual', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const assetId = await approvedVsl(workspaceId, projectId, marketId);

    // Below the 100-start volume floor: unresolved.
    await seedVslTraffic(workspaceId, projectId, assetId, 40, 20);
    expect(await metricActual(workspaceId, assetId, 'vsl_50_retention')).toBeNull();
    expect(await resolvePredictions(workspaceId)).toEqual({ resolved: 0, pending: 1 });

    // Clear the floor: 100 starts, 60 reach 50% → actual 0.60.
    await seedVslTraffic(workspaceId, projectId, assetId, 100, 60); // dedupe collapses the overlap
    const outcome = await metricActual(workspaceId, assetId, 'vsl_50_retention');
    expect(outcome).toEqual({ actual: 0.6, volume: 100 });
    expect(await resolvePredictions(workspaceId)).toEqual({ resolved: 1, pending: 0 });

    const listed = await listPredictionsForProject(workspaceId, projectId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.predicted).toBeCloseTo(0.35, 5);
    expect(listed[0]!.actual).toBeCloseTo(0.6, 5);
    expect(listed[0]!.brier).toBeCloseTo((0.35 - 0.6) ** 2, 5);
    expect(listed[0]!.resolvedAt).not.toBeNull();
  });

  it('calibration stores bounded adjustments that shape the NEXT forecast', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const first = await approvedVsl(workspaceId, projectId, marketId);
    await seedVslTraffic(workspaceId, projectId, first, 100, 60);
    await resolvePredictions(workspaceId);

    const report = await runCalibration(workspaceId);
    // Target factor 0.6/0.35 ≈ 1.71 → halfway from 1 ≈ 1.36 → clamped to 1.2.
    expect(report.adjustments.priorFactors.vsl_50_retention).toBe(PRIOR_FACTOR_MAX);
    expect(report.perMetric[0]).toMatchObject({ metric: 'vsl_50_retention', samples: 1 });
    expect(report.bounds).toContain('±20%');

    const stored = await getCalibration(workspaceId);
    expect(stored!.priorFactors.vsl_50_retention).toBe(PRIOR_FACTOR_MAX);

    // A second approved VSL forecasts from the CALIBRATED prior (0.35 × 1.2).
    const second = await approvedVsl(workspaceId, projectId, marketId);
    const rows = await tenantDb(workspaceId).findMany(predictions, eq(predictions.assetId, second));
    expect(Number(rows[0]!.predicted)).toBeCloseTo(0.35 * PRIOR_FACTOR_MAX, 4);
  });
});
