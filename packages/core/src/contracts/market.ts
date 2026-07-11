import { z } from 'zod';

/**
 * Market selection (WO-012). Candidates are scored on the starving-crowd
 * matrix; weights are config here (overridable later in admin). The full
 * market_profile.json contract (§4) is layered on in WO-013 — a candidate
 * carries the seed of it.
 */

/** Starving-crowd matrix weights (must sum to 1). */
export const STARVING_CROWD_WEIGHTS = {
  pain: 0.25,
  purchasing_power: 0.2,
  reachability: 0.2,
  urgency: 0.2,
  ltv: 0.15,
} as const;

export type ScoreDimension = keyof typeof STARVING_CROWD_WEIGHTS;

const score10 = z.number().min(0).max(10);

export const starvingCrowdScoresSchema = z.object({
  pain: score10,
  purchasing_power: score10,
  reachability: score10,
  urgency: score10,
  ltv: score10,
});
export type StarvingCrowdScores = z.infer<typeof starvingCrowdScoresSchema>;

export const marketCandidateSchema = z.object({
  label: z.string().min(1),
  avatar_hint: z.string().default(''),
  rationale: z.string().min(1),
  scores: starvingCrowdScoresSchema,
});
export type MarketCandidate = z.infer<typeof marketCandidateSchema>;

/** Model output: 8–12 candidates (spec WO-012). */
export const marketSelectionResultSchema = z.object({
  candidates: z.array(marketCandidateSchema).min(8).max(12),
});
export type MarketSelectionResult = z.infer<typeof marketSelectionResultSchema>;

export function parseMarketSelectionResult(data: unknown): MarketSelectionResult {
  return marketSelectionResultSchema.parse(data);
}

/** Weighted total on a 0–100 scale. */
export function scoreMarket(scores: StarvingCrowdScores): number {
  const total = (Object.keys(STARVING_CROWD_WEIGHTS) as ScoreDimension[]).reduce(
    (sum, dim) => sum + scores[dim] * STARVING_CROWD_WEIGHTS[dim],
    0,
  );
  return Math.round(total * 10 * 100) / 100; // 0–10 → 0–100, 2dp
}

export interface RankedCandidate extends MarketCandidate {
  total: number;
}

/** Sort candidates by weighted total, descending; ties keep input order. */
export function rankCandidates(candidates: MarketCandidate[]): RankedCandidate[] {
  return candidates
    .map((c, i) => ({ ...c, total: scoreMarket(c.scores), i }))
    .sort((a, b) => b.total - a.total || a.i - b.i)
    .map(({ i: _i, ...rest }) => rest);
}
