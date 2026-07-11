import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMOTION_CONFIG, evaluatePromotion } from './promotion.js';

describe('promotion heuristic (WO-044)', () => {
  it('promotion is impossible below the volume floor (acceptance)', () => {
    const verdict = evaluatePromotion({
      control: { visitors: 199, conversions: 10 },
      challenger: { visitors: 5000, conversions: 500 },
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.promote).toBe(false);
    expect(verdict.reason).toMatch(/Below minimum volume: control 199\/200/);
  });

  it('an uplift below the floor never promotes, however significant', () => {
    const verdict = evaluatePromotion({
      control: { visitors: 100_000, conversions: 5000 },
      challenger: { visitors: 100_000, conversions: 5200 }, // +4% uplift, huge n
    });
    expect(verdict.eligible).toBe(true);
    expect(verdict.promote).toBe(false);
    expect(verdict.reason).toMatch(/below the 10% floor/);
  });

  it('a big uplift on thin-but-legal volume needs the z threshold', () => {
    const verdict = evaluatePromotion({
      control: { visitors: 200, conversions: 6 },
      challenger: { visitors: 200, conversions: 8 }, // +33% uplift, z ≈ 0.55
    });
    expect(verdict.promote).toBe(false);
    expect(verdict.reason).toMatch(/directionally promising/);
    expect(verdict.zScore).toBeLessThan(DEFAULT_PROMOTION_CONFIG.zThreshold);
  });

  it('promotes when volume, uplift, and z all clear — and says it is directional', () => {
    const verdict = evaluatePromotion({
      control: { visitors: 1000, conversions: 30 },
      challenger: { visitors: 1000, conversions: 55 },
    });
    expect(verdict.promote).toBe(true);
    expect(verdict.uplift).toBeCloseTo(0.833, 2);
    expect(verdict.zScore).toBeGreaterThan(1.64);
    expect(verdict.reason).toMatch(/Directional heuristic/);
  });

  it('the thresholds are config', () => {
    const strict = { minSampleSize: 5000, minUplift: 0.5, zThreshold: 3 };
    const verdict = evaluatePromotion({
      control: { visitors: 1000, conversions: 30 },
      challenger: { visitors: 1000, conversions: 55 },
      config: strict,
    });
    expect(verdict.eligible).toBe(false); // 1000 < 5000
  });
});
