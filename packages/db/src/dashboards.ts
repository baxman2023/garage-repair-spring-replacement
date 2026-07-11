import { eq } from 'drizzle-orm';
import { tenantDb } from './guard.js';
import { events, predictions, assets as assetsTable } from './schema/index.js';

/**
 * Ledger dashboards (WO-046): deterministic aggregations over the event
 * stream. The retention curve is computed DIRECTLY from raw vsl_quartile
 * events (acceptance: it must match them, so it IS them).
 */

export interface RetentionCurve {
  starts: number;
  q25: number;
  q50: number;
  q75: number;
  q95: number;
}

export interface MarketFunnel {
  marketId: string | null;
  pageViews: number;
  quizStarts: number;
  quizCompletes: number;
  optins: number;
  callsStarted: number;
  callsQualified: number;
  sales: number;
  refunds: number;
  retention: RetentionCurve;
}

function emptyFunnel(marketId: string | null): MarketFunnel {
  return {
    marketId,
    pageViews: 0,
    quizStarts: 0,
    quizCompletes: 0,
    optins: 0,
    callsStarted: 0,
    callsQualified: 0,
    sales: 0,
    refunds: 0,
    retention: { starts: 0, q25: 0, q50: 0, q75: 0, q95: 0 },
  };
}

/** Per-market funnel: traffic → quiz → optin → VSL retention → sale. */
export async function projectFunnel(
  workspaceId: string,
  projectId: string,
): Promise<{ markets: MarketFunnel[]; total: MarketFunnel }> {
  const rows = await tenantDb(workspaceId).findMany(events, eq(events.projectId, projectId));
  const byMarket = new Map<string | null, MarketFunnel>();
  const total = emptyFunnel(null);

  const bump = (funnel: MarketFunnel, row: (typeof rows)[number]) => {
    switch (row.type) {
      case 'page_view':
        funnel.pageViews++;
        funnel.retention.starts++;
        break;
      case 'quiz_start':
        funnel.quizStarts++;
        break;
      case 'quiz_complete':
        funnel.quizCompletes++;
        break;
      case 'optin':
        funnel.optins++;
        break;
      case 'call_start':
        funnel.callsStarted++;
        break;
      case 'call_qualified':
        funnel.callsQualified++;
        break;
      case 'sale':
        funnel.sales++;
        break;
      case 'refund':
        funnel.refunds++;
        break;
      case 'vsl_quartile': {
        const q = Number((row.value as { quartile?: number } | null)?.quartile);
        if (q === 25) funnel.retention.q25++;
        if (q === 50) funnel.retention.q50++;
        if (q === 75) funnel.retention.q75++;
        if (q === 95) funnel.retention.q95++;
        break;
      }
      default:
        break;
    }
  };

  for (const row of rows) {
    const key = row.marketId ?? null;
    const funnel = byMarket.get(key) ?? emptyFunnel(key);
    bump(funnel, row);
    byMarket.set(key, funnel);
    bump(total, row);
  }

  return {
    markets: [...byMarket.values()].sort((a, b) => (a.marketId ?? '').localeCompare(b.marketId ?? '')),
    total,
  };
}

/** Raw quartile curve for one VSL asset — counts equal the raw events. */
export async function assetRetentionCurve(
  workspaceId: string,
  assetId: string,
): Promise<RetentionCurve> {
  const rows = await tenantDb(workspaceId).findMany(events, eq(events.assetId, assetId));
  const curve: RetentionCurve = { starts: 0, q25: 0, q50: 0, q75: 0, q95: 0 };
  for (const row of rows) {
    if (row.type === 'page_view') curve.starts++;
    if (row.type === 'vsl_quartile') {
      const q = Number((row.value as { quartile?: number } | null)?.quartile);
      if (q === 25) curve.q25++;
      if (q === 50) curve.q50++;
      if (q === 75) curve.q75++;
      if (q === 95) curve.q95++;
    }
  }
  return curve;
}

/** Brier trend: resolved forecasts in resolution order, with a running mean. */
export async function brierTrend(
  workspaceId: string,
  projectId: string,
): Promise<Array<{ at: Date; metric: string; brier: number; runningMean: number }>> {
  const db = tenantDb(workspaceId);
  const assets = await db.findMany(assetsTable, eq(assetsTable.projectId, projectId));
  const { quizDefinitions } = await import('./schema/index.js');
  const subjectIds = new Set(assets.map((a) => a.id));
  for (const quiz of await db.findMany(quizDefinitions, eq(quizDefinitions.projectId, projectId))) {
    subjectIds.add(quiz.id);
  }
  const rows = (await db.findMany(predictions, undefined)).filter(
    (r) => subjectIds.has(r.assetId) && r.resolvedAt !== null && r.brier !== null,
  );
  rows.sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime() || a.id.localeCompare(b.id));
  let sum = 0;
  return rows.map((r, i) => {
    sum += Number(r.brier);
    return {
      at: r.resolvedAt!,
      metric: r.metric,
      brier: Number(r.brier),
      runningMean: Math.round((sum / (i + 1)) * 1e6) / 1e6,
    };
  });
}

/** Funnel CSV export (deterministic column order). */
export function funnelCsv(
  funnel: { markets: MarketFunnel[]; total: MarketFunnel },
  marketLabels: Map<string, string>,
): string {
  const header =
    'market,page_views,quiz_starts,quiz_completes,optins,calls_started,calls_qualified,sales,refunds,retention_q25,retention_q50,retention_q75,retention_q95';
  const line = (f: MarketFunnel, label: string) =>
    [
      label,
      f.pageViews,
      f.quizStarts,
      f.quizCompletes,
      f.optins,
      f.callsStarted,
      f.callsQualified,
      f.sales,
      f.refunds,
      f.retention.q25,
      f.retention.q50,
      f.retention.q75,
      f.retention.q95,
    ].join(',');
  return [
    header,
    ...funnel.markets.map((m) => line(m, m.marketId ? (marketLabels.get(m.marketId) ?? m.marketId) : 'unattributed')),
    line(funnel.total, 'TOTAL'),
  ].join('\n');
}
