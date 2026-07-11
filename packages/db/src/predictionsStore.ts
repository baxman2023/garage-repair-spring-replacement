import { eq, isNull } from 'drizzle-orm';
import {
  brierScore,
  calibratedPrior,
  computeCalibration,
  metricForAssetType,
  type CalibrationAdjustments,
  type CalibrationReport,
  type LensOutcomeSample,
  type PredictionMetric,
  type ResolvedPrediction,
} from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { calibrationState, events, predictions, assets as assetsTable } from './schema/index.js';

/**
 * Predictions & Brier scoring (WO-045). Forecasts record at approval from the
 * workspace's CALIBRATED priors; the resolver scores them against ledger
 * actuals once the metric's volume threshold clears; calibration nudges
 * priors/lens weights within provable bounds and stores a report.
 */

export type PredictionRow = typeof predictions.$inferSelect;

export async function getCalibration(workspaceId: string): Promise<CalibrationAdjustments | null> {
  const rows = await getDb()
    .select()
    .from(calibrationState)
    .where(eq(calibrationState.workspaceId, workspaceId))
    .limit(1);
  if (!rows[0]) return null;
  const adj = rows[0].adjustments as { priorFactors?: CalibrationAdjustments['priorFactors']; lensWeights?: CalibrationAdjustments['lensWeights'] };
  return { priorFactors: adj.priorFactors ?? {}, lensWeights: adj.lensWeights ?? {} };
}

/** Record the asset's forecast at approval (no-op for types without a metric). */
export async function recordPredictionAtApproval(params: {
  workspaceId: string;
  assetId: string;
}): Promise<{ metric: PredictionMetric; predicted: number } | null> {
  const db = tenantDb(params.workspaceId);
  const asset = await db.findFirst(assetsTable, eq(assetsTable.id, params.assetId));
  if (!asset) return null;
  const metric = metricForAssetType(asset.type);
  if (!metric) return null;
  const existing = await db.findMany(predictions, eq(predictions.assetId, params.assetId));
  if (existing.some((p) => p.metric === metric)) return null; // one forecast per metric

  const prior = calibratedPrior(metric, await getCalibration(params.workspaceId));
  await db.insert(predictions, {
    assetId: params.assetId,
    metric,
    predicted: prior.prior.toFixed(6),
    band: { low: prior.band.low, high: prior.band.high },
  });
  return { metric, predicted: prior.prior };
}

/** Record the quiz optin forecast when a quiz definition is (re)generated. */
export async function recordQuizPrediction(params: {
  workspaceId: string;
  quizDefinitionId: string;
}): Promise<void> {
  const db = tenantDb(params.workspaceId);
  const existing = await db.findMany(predictions, eq(predictions.assetId, params.quizDefinitionId));
  if (existing.some((p) => p.metric === 'quiz_optin_rate')) return;
  const prior = calibratedPrior('quiz_optin_rate', await getCalibration(params.workspaceId));
  await db.insert(predictions, {
    assetId: params.quizDefinitionId,
    metric: 'quiz_optin_rate',
    predicted: prior.prior.toFixed(6),
    band: { low: prior.band.low, high: prior.band.high },
  });
}

/** Compute a metric's actual from the ledger. Null while below volume. */
export async function metricActual(
  workspaceId: string,
  subjectId: string,
  metric: PredictionMetric,
): Promise<{ actual: number; volume: number } | null> {
  const db = tenantDb(workspaceId);
  const prior = calibratedPrior(metric, null);

  if (metric === 'letter_cvr') {
    const rows = await db.findMany(events, eq(events.assetId, subjectId));
    const visitors = rows.filter((r) => r.type === 'page_view').length;
    if (visitors < prior.minVolume) return null;
    const sales = rows.filter((r) => r.type === 'sale').length;
    return { actual: sales / visitors, volume: visitors };
  }
  if (metric === 'vsl_50_retention') {
    const rows = await db.findMany(events, eq(events.assetId, subjectId));
    const starts = rows.filter((r) => r.type === 'page_view').length;
    if (starts < prior.minVolume) return null;
    const reached50 = rows.filter(
      (r) => r.type === 'vsl_quartile' && Number((r.value as { quartile?: number } | null)?.quartile) >= 50,
    ).length;
    return { actual: Math.min(1, reached50 / starts), volume: starts };
  }
  if (metric === 'quiz_optin_rate') {
    // Subject = quiz definition; events are session-scoped with source quiz.
    const { quizSessions, quizLeads } = await import('./schema/index.js');
    const sessions = await db.findMany(quizSessions, eq(quizSessions.quizDefinitionId, subjectId));
    if (sessions.length < prior.minVolume) return null;
    const leads = await db.findMany(quizLeads, eq(quizLeads.quizDefinitionId, subjectId));
    const optins = leads.filter((l) =>
      Object.values((l.contact ?? {}) as Record<string, string>).some((v) => v?.trim()),
    ).length;
    return { actual: optins / sessions.length, volume: sessions.length };
  }
  if (metric === 'email_open_rate') {
    // APPROXIMATION (documented): opens per optin in the asset's market —
    // send counts are not ingested, so the optin list stands in for sends.
    const asset = await db.findFirst(assetsTable, eq(assetsTable.id, subjectId));
    if (!asset?.marketId) return null;
    const rows = await db.findMany(events, eq(events.marketId, asset.marketId));
    const optins = rows.filter((r) => r.type === 'optin').length;
    if (optins < prior.minVolume) return null;
    const opens = rows.filter((r) => r.type === 'email_open').length;
    return { actual: Math.min(1, opens / optins), volume: optins };
  }
  return null;
}

/** The resolver: score every unresolved prediction whose volume cleared. */
export async function resolvePredictions(
  workspaceId: string,
): Promise<{ resolved: number; pending: number }> {
  const db = tenantDb(workspaceId);
  const open = await db.findMany(predictions, isNull(predictions.resolvedAt));
  let resolved = 0;
  for (const row of open) {
    const outcome = await metricActual(workspaceId, row.assetId, row.metric as PredictionMetric);
    if (!outcome) continue;
    await db.update(
      predictions,
      {
        actual: outcome.actual.toFixed(6),
        brier: brierScore(Number(row.predicted), outcome.actual).toFixed(6),
        resolvedAt: new Date(),
      },
      eq(predictions.id, row.id),
    );
    resolved++;
  }
  return { resolved, pending: open.length - resolved };
}

/** Run calibration from resolved predictions (+ lens outcome samples). */
export async function runCalibration(workspaceId: string): Promise<CalibrationReport> {
  const db = tenantDb(workspaceId);
  const rows = await db.findMany(predictions, undefined);
  const resolvedRows = rows.filter((r) => r.resolvedAt !== null && r.actual !== null);
  const resolved: ResolvedPrediction[] = resolvedRows.map((r) => ({
    metric: r.metric as PredictionMetric,
    predicted: Number(r.predicted),
    actual: Number(r.actual),
  }));

  // Lens outcome samples: council scores of assets with resolved forecasts.
  const { listCouncilReviewsForAsset } = await import('./assetsStore.js');
  const lensSamples: LensOutcomeSample[] = [];
  for (const r of resolvedRows) {
    const grouped = await listCouncilReviewsForAsset(workspaceId, r.assetId).catch(() => []);
    const latest = grouped[grouped.length - 1];
    if (!latest) continue;
    const lensScores: Record<string, number> = {};
    for (const review of latest.reviews) lensScores[review.lens] = review.score;
    lensSamples.push({ lensScores, outcomeGood: Number(r.actual) >= Number(r.predicted) });
  }

  const previous = await getCalibration(workspaceId);
  const report = computeCalibration({ resolved, lensSamples, previous });

  const existing = await getDb()
    .select()
    .from(calibrationState)
    .where(eq(calibrationState.workspaceId, workspaceId))
    .limit(1);
  if (existing[0]) {
    await getDb()
      .update(calibrationState)
      .set({ adjustments: { ...report.adjustments, lastReport: report } })
      .where(eq(calibrationState.id, existing[0].id));
  } else {
    const { newId } = await import('@copyforge/core');
    await getDb().insert(calibrationState).values({
      id: newId(),
      workspaceId,
      adjustments: { ...report.adjustments, lastReport: report },
    });
  }
  return report;
}

/** Predictions with actuals for display, per project. */
export async function listPredictionsForProject(workspaceId: string, projectId: string) {
  const db = tenantDb(workspaceId);
  const assets = await db.findMany(assetsTable, eq(assetsTable.projectId, projectId));
  const assetIds = new Set(assets.map((a) => a.id));
  const { quizDefinitions } = await import('./schema/index.js');
  for (const quiz of await db.findMany(quizDefinitions, eq(quizDefinitions.projectId, projectId))) {
    assetIds.add(quiz.id);
  }
  const rows = await db.findMany(predictions, undefined);
  return rows
    .filter((r) => assetIds.has(r.assetId))
    .map((r) => ({
      id: r.id,
      subjectId: r.assetId,
      assetType: assets.find((a) => a.id === r.assetId)?.type ?? 'quiz',
      metric: r.metric,
      predicted: Number(r.predicted),
      band: r.band as { low: number; high: number } | null,
      actual: r.actual !== null ? Number(r.actual) : null,
      brier: r.brier !== null ? Number(r.brier) : null,
      resolvedAt: r.resolvedAt,
    }));
}
