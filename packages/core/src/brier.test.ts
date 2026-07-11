import { describe, expect, it } from 'vitest';
import {
  BASE_PRIORS,
  brierScore,
  calibratedPrior,
  computeCalibration,
  metricForAssetType,
  PRIOR_FACTOR_MAX,
  PRIOR_FACTOR_MIN,
} from './brier.js';
import { DEFAULT_COUNCIL_CONFIG, WEIGHT_MAX, WEIGHT_MIN, type CouncilLens } from './council.js';

describe('Brier math (WO-045 acceptance)', () => {
  it('squared error of rate forecasts, clamped to [0,1]', () => {
    expect(brierScore(0.3, 0.3)).toBe(0);
    expect(brierScore(0.5, 0.2)).toBeCloseTo(0.09, 6);
    expect(brierScore(0.02, 0.045)).toBeCloseTo(0.000625, 6);
    expect(brierScore(1.5, -0.2)).toBe(1); // inputs clamped
  });

  it('asset types map to their headline metric', () => {
    expect(metricForAssetType('vsl')).toBe('vsl_50_retention');
    expect(metricForAssetType('sales_letter')).toBe('letter_cvr');
    expect(metricForAssetType('email_sequence')).toBe('email_open_rate');
    expect(metricForAssetType('meta_ad')).toBeNull();
  });
});

describe('calibration is provably bounded (WO-045 acceptance)', () => {
  it('prior factors clamp to [0.8, 1.2] no matter how wild the actuals', () => {
    // Actuals 10× the prior…
    const high = computeCalibration({
      resolved: Array.from({ length: 10 }, () => ({
        metric: 'letter_cvr' as const,
        predicted: 0.02,
        actual: 0.2,
      })),
    });
    expect(high.adjustments.priorFactors.letter_cvr).toBe(PRIOR_FACTOR_MAX);
    // …and actuals at zero.
    const low = computeCalibration({
      resolved: Array.from({ length: 10 }, () => ({
        metric: 'letter_cvr' as const,
        predicted: 0.02,
        actual: 0,
      })),
    });
    expect(low.adjustments.priorFactors.letter_cvr).toBe(PRIOR_FACTOR_MIN);

    // calibratedPrior applies the clamp even against a corrupted state.
    const corrupted = calibratedPrior('letter_cvr', { priorFactors: { letter_cvr: 99 }, lensWeights: {} });
    expect(corrupted.prior).toBeCloseTo(BASE_PRIORS.letter_cvr.prior * PRIOR_FACTOR_MAX, 6);
  });

  it('lens weights stay inside the ±20% council band; floors are not an output', () => {
    const samples = Array.from({ length: 20 }, (_v, i) => ({
      lensScores: { halbert: i < 10 ? 95 : 55, kennedy: 75 } as Partial<Record<CouncilLens, number>>,
      outcomeGood: i < 10,
    }));
    // Run calibration repeatedly from its own output — weights must never escape.
    let previous = undefined as ReturnType<typeof computeCalibration>['adjustments'] | undefined;
    for (let round = 0; round < 10; round++) {
      const report = computeCalibration({ resolved: [], lensSamples: samples, previous });
      previous = report.adjustments;
      for (const w of Object.values(report.adjustments.lensWeights)) {
        expect(w).toBeGreaterThanOrEqual(WEIGHT_MIN);
        expect(w).toBeLessThanOrEqual(WEIGHT_MAX);
      }
      // Floors are structurally absent from calibration output.
      expect('floor' in report.adjustments).toBe(false);
      expect(report.bounds).toContain('floor');
    }
    expect(previous!.lensWeights.halbert).toBe(WEIGHT_MAX); // saturated at the cap
    // The council's own floor constant is untouched by any of this.
    expect(DEFAULT_COUNCIL_CONFIG.lensFloor ?? 70).toBeGreaterThanOrEqual(70);
  });

  it('needs ≥4 lens samples before touching weights', () => {
    const report = computeCalibration({
      resolved: [],
      lensSamples: [{ lensScores: { halbert: 90 }, outcomeGood: true }],
    });
    expect(report.lensNotes[0]).toMatch(/need ≥4/);
    expect(report.adjustments.lensWeights.halbert).toBe(1);
  });
});
