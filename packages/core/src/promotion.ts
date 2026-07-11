/**
 * Challenger promotion heuristic (WO-044, pure).
 *
 * HONESTY NOTE (per spec): this is a DIRECTIONAL heuristic, not lab-grade
 * statistics. A one-sided two-proportion z-test with a modest threshold plus
 * a minimum-uplift floor guards against promoting noise, but it does not
 * correct for peeking, multiple comparisons, or novelty effects. Treat a
 * promotion as "very probably better", never as proof.
 */

export interface PromotionConfig {
  /** Minimum visitors PER ARM before promotion is even considered. */
  minSampleSize: number;
  /** Minimum relative uplift of the challenger over the control (0.10 = +10%). */
  minUplift: number;
  /** One-sided z threshold (1.64 ≈ 95% directional confidence). */
  zThreshold: number;
}

export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  minSampleSize: 200,
  minUplift: 0.1,
  zThreshold: 1.64,
};

export interface ArmMetrics {
  visitors: number;
  conversions: number;
}

export interface PromotionVerdict {
  /** Both arms cleared the volume floor (promotion impossible otherwise). */
  eligible: boolean;
  promote: boolean;
  reason: string;
  controlRate: number;
  challengerRate: number;
  /** Relative uplift ((challenger − control) / control). */
  uplift: number;
  zScore: number;
}

export function evaluatePromotion(params: {
  control: ArmMetrics;
  challenger: ArmMetrics;
  config?: PromotionConfig;
}): PromotionVerdict {
  const config = params.config ?? DEFAULT_PROMOTION_CONFIG;
  const c = params.control;
  const t = params.challenger;
  const controlRate = c.visitors > 0 ? c.conversions / c.visitors : 0;
  const challengerRate = t.visitors > 0 ? t.conversions / t.visitors : 0;
  const uplift = controlRate > 0 ? (challengerRate - controlRate) / controlRate : challengerRate > 0 ? Infinity : 0;

  const base = { controlRate, challengerRate, uplift, zScore: 0 };

  if (c.visitors < config.minSampleSize || t.visitors < config.minSampleSize) {
    return {
      ...base,
      eligible: false,
      promote: false,
      reason: `Below minimum volume: control ${c.visitors}/${config.minSampleSize}, challenger ${t.visitors}/${config.minSampleSize} visitors.`,
    };
  }

  // One-sided two-proportion z-test (pooled).
  const pooled = (c.conversions + t.conversions) / (c.visitors + t.visitors);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / c.visitors + 1 / t.visitors));
  const zScore = se === 0 ? 0 : (challengerRate - controlRate) / se;

  if (uplift < config.minUplift) {
    return {
      ...base,
      zScore,
      eligible: true,
      promote: false,
      reason: `Uplift ${(uplift * 100).toFixed(1)}% below the ${(config.minUplift * 100).toFixed(0)}% floor.`,
    };
  }
  if (zScore < config.zThreshold) {
    return {
      ...base,
      zScore,
      eligible: true,
      promote: false,
      reason: `z=${zScore.toFixed(2)} below the ${config.zThreshold} threshold — directionally promising, not yet convincing.`,
    };
  }
  return {
    ...base,
    zScore,
    eligible: true,
    promote: true,
    reason: `Challenger converts ${(challengerRate * 100).toFixed(2)}% vs control ${(controlRate * 100).toFixed(2)}% (uplift ${(uplift * 100).toFixed(1)}%, z=${zScore.toFixed(2)}). Directional heuristic — monitor after promotion.`,
  };
}
