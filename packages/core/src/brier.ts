import { clampWeights, DEFAULT_COUNCIL_CONFIG, type CouncilLens } from './council.js';

/**
 * Predictions & Brier scoring (WO-045, pure).
 *
 * At approval the system forecasts each asset's headline metric (a rate in
 * [0,1]) from its calibrated prior, with a probability band. The resolver
 * scores forecasts against ledger actuals with the Brier-style squared error.
 * Calibration nudges priors toward observed reality and Council lens weights
 * toward lenses that liked winners — PROVABLY BOUNDED: priors move at most
 * ±20% from their base per state, lens weights ride the existing ±20% clamp,
 * and the §6 per-lens floor is structurally untouchable (calibration has no
 * floor field, and the council config assembly ignores any it were given).
 */

export type PredictionMetric =
  | 'quiz_optin_rate'
  | 'vsl_50_retention'
  | 'letter_cvr'
  | 'email_open_rate';

export interface MetricPrior {
  metric: PredictionMetric;
  prior: number;
  band: { low: number; high: number };
  /** Denominator events needed before the resolver will score it. */
  minVolume: number;
}

/** Base priors (config): honest industry-shaped defaults, not promises. */
export const BASE_PRIORS: Record<PredictionMetric, MetricPrior> = {
  quiz_optin_rate: { metric: 'quiz_optin_rate', prior: 0.3, band: { low: 0.18, high: 0.45 }, minVolume: 50 },
  vsl_50_retention: { metric: 'vsl_50_retention', prior: 0.35, band: { low: 0.22, high: 0.5 }, minVolume: 100 },
  letter_cvr: { metric: 'letter_cvr', prior: 0.02, band: { low: 0.008, high: 0.045 }, minVolume: 200 },
  email_open_rate: { metric: 'email_open_rate', prior: 0.35, band: { low: 0.2, high: 0.55 }, minVolume: 50 },
};

/** The metric an asset type forecasts at approval (null = no forecast). */
export function metricForAssetType(assetType: string): PredictionMetric | null {
  switch (assetType) {
    case 'vsl':
      return 'vsl_50_retention';
    case 'sales_letter':
      return 'letter_cvr';
    case 'email_sequence':
      return 'email_open_rate';
    default:
      return null;
  }
}

/** Brier-style squared error for a rate forecast. */
export function brierScore(predicted: number, actual: number): number {
  const p = Math.min(1, Math.max(0, predicted));
  const a = Math.min(1, Math.max(0, actual));
  return Math.round((p - a) ** 2 * 1e6) / 1e6;
}

// --- Calibration ---------------------------------------------------------------------

export interface CalibrationAdjustments {
  /** Multiplier per metric applied to the BASE prior, clamped to [0.8, 1.2]. */
  priorFactors: Partial<Record<PredictionMetric, number>>;
  /** Council lens weights, clamped to §6's ±20% band around 1.0. */
  lensWeights: Partial<Record<CouncilLens, number>>;
}

export const PRIOR_FACTOR_MIN = 0.8;
export const PRIOR_FACTOR_MAX = 1.2;

/** Effective prior after calibration — provably inside ±20% of base. */
export function calibratedPrior(
  metric: PredictionMetric,
  adjustments?: CalibrationAdjustments | null,
): MetricPrior {
  const base = BASE_PRIORS[metric];
  const rawFactor = adjustments?.priorFactors?.[metric] ?? 1;
  const factor = Math.min(PRIOR_FACTOR_MAX, Math.max(PRIOR_FACTOR_MIN, rawFactor));
  return {
    ...base,
    prior: Math.round(base.prior * factor * 1e6) / 1e6,
    band: {
      low: Math.round(base.band.low * factor * 1e6) / 1e6,
      high: Math.round(base.band.high * factor * 1e6) / 1e6,
    },
  };
}

export interface ResolvedPrediction {
  metric: PredictionMetric;
  predicted: number;
  actual: number;
}

export interface LensOutcomeSample {
  lensScores: Partial<Record<CouncilLens, number>>;
  /** Did the asset beat its prior (actual ≥ predicted)? */
  outcomeGood: boolean;
}

export interface CalibrationReport {
  adjustments: CalibrationAdjustments;
  perMetric: Array<{
    metric: PredictionMetric;
    samples: number;
    meanActual: number;
    meanBrier: number;
    priorFactor: number;
  }>;
  lensNotes: string[];
  /** Structural guarantee restated for the report reader. */
  bounds: string;
}

/**
 * Compute new calibration from resolved predictions + lens outcome samples.
 * Directional and bounded: prior factors move toward the observed mean but
 * never past ±20% of base; lens weights nudge ±0.05 per run toward lenses
 * that scored winners higher, clamped by the council's ±20% band. The §6
 * floor is not an output of calibration at all.
 */
export function computeCalibration(params: {
  resolved: ResolvedPrediction[];
  lensSamples?: LensOutcomeSample[];
  previous?: CalibrationAdjustments | null;
}): CalibrationReport {
  const byMetric = new Map<PredictionMetric, ResolvedPrediction[]>();
  for (const r of params.resolved) {
    const list = byMetric.get(r.metric) ?? [];
    list.push(r);
    byMetric.set(r.metric, list);
  }

  const priorFactors: CalibrationAdjustments['priorFactors'] = { ...params.previous?.priorFactors };
  const perMetric: CalibrationReport['perMetric'] = [];
  for (const [metric, rows] of byMetric) {
    const base = BASE_PRIORS[metric];
    const meanActual = rows.reduce((s, r) => s + r.actual, 0) / rows.length;
    const meanBrier = rows.reduce((s, r) => s + brierScore(r.predicted, r.actual), 0) / rows.length;
    // Move the factor halfway toward the observed mean, then clamp.
    const target = base.prior > 0 ? meanActual / base.prior : 1;
    const current = priorFactors[metric] ?? 1;
    const nudged = current + (target - current) * 0.5;
    const factor = Math.min(PRIOR_FACTOR_MAX, Math.max(PRIOR_FACTOR_MIN, nudged));
    priorFactors[metric] = Math.round(factor * 1e4) / 1e4;
    perMetric.push({ metric, samples: rows.length, meanActual, meanBrier, priorFactor: priorFactors[metric]! });
  }

  // Lens weights: winners' lenses up, losers' down, ±0.05 per run, then clamp.
  const lensWeights: Record<string, number> = {
    ...DEFAULT_COUNCIL_CONFIG.weights,
    ...params.previous?.lensWeights,
  };
  const lensNotes: string[] = [];
  const samples = params.lensSamples ?? [];
  if (samples.length >= 4) {
    const lenses = new Set<CouncilLens>();
    for (const s of samples) for (const lens of Object.keys(s.lensScores) as CouncilLens[]) lenses.add(lens);
    for (const lens of lenses) {
      const good = samples.filter((s) => s.outcomeGood && s.lensScores[lens] !== undefined);
      const bad = samples.filter((s) => !s.outcomeGood && s.lensScores[lens] !== undefined);
      if (good.length === 0 || bad.length === 0) continue;
      const goodMean = good.reduce((s, x) => s + x.lensScores[lens]!, 0) / good.length;
      const badMean = bad.reduce((s, x) => s + x.lensScores[lens]!, 0) / bad.length;
      const delta = goodMean - badMean > 3 ? 0.05 : badMean - goodMean > 3 ? -0.05 : 0;
      if (delta !== 0) {
        lensWeights[lens] = Math.round(((lensWeights[lens] ?? 1) + delta) * 1e4) / 1e4;
        lensNotes.push(
          `${lens}: winners ${goodMean.toFixed(1)} vs losers ${badMean.toFixed(1)} → weight ${delta > 0 ? '+' : ''}${delta}`,
        );
      }
    }
  } else {
    lensNotes.push(`Only ${samples.length} lens outcome samples — need ≥4 before touching weights.`);
  }
  const clamped = clampWeights(lensWeights as Record<CouncilLens, number>);

  return {
    adjustments: { priorFactors, lensWeights: clamped },
    perMetric,
    lensNotes,
    bounds:
      'Prior factors clamped to [0.8, 1.2]×base; lens weights clamped to the ±20% council band; the §6 per-lens floor is not a calibration output and never moves.',
  };
}
