import { z } from 'zod';

/**
 * Quiz contract (WO-039): the runtime market router + prequalifier. Routing
 * questions carry per-option weights into the 5 market buckets; prequal
 * questions (budget/urgency) carry disqualification flags. Scoring is a pure
 * weighted sum; the simulator proves the routing works BEFORE anything ships.
 */

export const QUIZ_SCHEMA_VERSION = '1';
export const MIN_ROUTING_QUESTIONS = 5;
export const MAX_ROUTING_QUESTIONS = 8;

export const quizOptionSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  /** marketId → weight (routing options). */
  weights: z.record(z.string(), z.number()).default({}),
  /** Prequal options may disqualify (budget/urgency floor). */
  disqualify: z.boolean().default(false),
});
export type QuizOption = z.infer<typeof quizOptionSchema>;

export const quizQuestionSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(['routing', 'prequal']),
  text: z.string().trim().min(1),
  options: z.array(quizOptionSchema).min(2).max(6),
});
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const quizBandSchema = z.object({
  id: z.string().trim().min(1),
  marketId: z.string().length(26),
  label: z.string().trim().min(1),
  /** The band's results page: that market's short-form letter + CTA blocks. */
  resultBlocks: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.string().min(1),
        text: z.string().min(1),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(2),
});
export type QuizBand = z.infer<typeof quizBandSchema>;

export const quizScoringSchema = z.object({
  method: z.literal('weighted_sum'),
  /** Lead capture sits between the last question and the results. */
  lead_capture: z.object({
    headline: z.string().trim().min(1),
    button: z.string().trim().min(1),
    fields: z.array(z.enum(['name', 'email', 'phone'])).min(1),
  }),
  /** Decline-with-dignity page for disqualified respondents. */
  decline: z.object({
    headline: z.string().trim().min(1),
    body: z.string().trim().min(1),
  }),
});
export type QuizScoring = z.infer<typeof quizScoringSchema>;

export interface QuizDefinition {
  slug: string;
  questions: QuizQuestion[];
  scoring: QuizScoring;
  bands: QuizBand[];
}

/** Structural validation beyond field shapes (WO-039 rules). */
export function validateQuizDefinition(def: QuizDefinition): void {
  const routing = def.questions.filter((q) => q.kind === 'routing');
  const prequal = def.questions.filter((q) => q.kind === 'prequal');
  if (routing.length < MIN_ROUTING_QUESTIONS || routing.length > MAX_ROUTING_QUESTIONS) {
    throw new Error(
      `Quiz needs ${MIN_ROUTING_QUESTIONS}-${MAX_ROUTING_QUESTIONS} routing questions; got ${routing.length}.`,
    );
  }
  if (prequal.length < 1) throw new Error('Quiz needs at least one prequal (budget/urgency) question.');
  if (!prequal.some((q) => q.options.some((o) => o.disqualify))) {
    throw new Error('At least one prequal option must disqualify.');
  }
  const marketIds = new Set(def.bands.map((b) => b.marketId));
  if (def.bands.length !== 5 || marketIds.size !== 5) {
    throw new Error(`Quiz needs exactly 5 bands mapped to 5 distinct markets; got ${def.bands.length}.`);
  }
  const ids = new Set<string>();
  for (const q of def.questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id "${q.id}".`);
    ids.add(q.id);
    for (const o of q.options) {
      for (const marketId of Object.keys(o.weights)) {
        if (!marketIds.has(marketId)) {
          throw new Error(`Option "${q.id}/${o.id}" weights unknown market "${marketId}".`);
        }
      }
    }
    if (q.kind === 'routing' && !q.options.some((o) => Object.values(o.weights).some((w) => w > 0))) {
      throw new Error(`Routing question "${q.id}" has no positively-weighted option.`);
    }
  }
  // Every market must be the TOP weight of at least one option somewhere —
  // otherwise that bucket is unreachable.
  const topWeighted = new Set<string>();
  for (const q of routing) {
    for (const o of q.options) {
      const entries = Object.entries(o.weights).filter(([, w]) => w > 0);
      if (entries.length === 0) continue;
      entries.sort((a, b) => b[1] - a[1]);
      topWeighted.add(entries[0]![0]);
    }
  }
  for (const marketId of marketIds) {
    if (!topWeighted.has(marketId)) {
      throw new Error(`Market "${marketId}" is unreachable: no option top-weights it.`);
    }
  }
}

// --- Scoring ---------------------------------------------------------------------

export interface QuizScoreResult {
  disqualified: boolean;
  totals: Record<string, number>;
  /** Winning band id (null when disqualified). */
  bandId: string | null;
  marketId: string | null;
}

/** Pure weighted-sum scoring. Ties break by band order (rank order). */
export function scoreQuizAnswers(
  def: QuizDefinition,
  answers: Record<string, string>,
): QuizScoreResult {
  const totals: Record<string, number> = {};
  for (const band of def.bands) totals[band.marketId] = 0;
  let disqualified = false;

  for (const q of def.questions) {
    const optionId = answers[q.id];
    if (!optionId) continue;
    const option = q.options.find((o) => o.id === optionId);
    if (!option) throw new Error(`Answer "${optionId}" is not an option of question "${q.id}".`);
    if (option.disqualify) disqualified = true;
    for (const [marketId, weight] of Object.entries(option.weights)) {
      totals[marketId] = (totals[marketId] ?? 0) + weight;
    }
  }

  if (disqualified) return { disqualified: true, totals, bandId: null, marketId: null };

  let winner = def.bands[0]!;
  for (const band of def.bands) {
    if ((totals[band.marketId] ?? 0) > (totals[winner.marketId] ?? 0)) winner = band;
  }
  return { disqualified: false, totals, bandId: winner.id, marketId: winner.marketId };
}

// --- Routing simulator (WO-039 acceptance) --------------------------------------------

/** Deterministic LCG — the simulator must be CI-stable (no Math.random). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface RoutingSimulation {
  perBucket: Record<string, { intended: number; routed: number; hitRate: number }>;
  disqualified: { intended: number; tagged: number };
  totalSets: number;
  /** Every intended bucket routed ≥ the threshold share of its sets. */
  pass: boolean;
}

/**
 * Simulate n synthetic answer sets: for each market bucket, generate sets
 * biased toward it (top-weighted option with p=0.75, random otherwise) plus a
 * disqualified cohort, then verify the scorer routes them as intended.
 */
export function simulateRouting(
  def: QuizDefinition,
  totalSets = 1000,
  seed = 42,
  hitRateThreshold = 0.7,
): RoutingSimulation {
  const rand = seededRandom(seed);
  const routing = def.questions.filter((q) => q.kind === 'routing');
  const prequal = def.questions.filter((q) => q.kind === 'prequal');
  const disqualifiedShare = 0.1;
  const dqSets = Math.floor(totalSets * disqualifiedShare);
  const perMarket = Math.floor((totalSets - dqSets) / def.bands.length);

  const pickBiased = (q: QuizQuestion, marketId: string): string => {
    if (rand() < 0.75) {
      let best: QuizOption | null = null;
      for (const o of q.options) {
        if ((o.weights[marketId] ?? 0) > (best ? (best.weights[marketId] ?? 0) : 0)) best = o;
      }
      if (best) return best.id;
    }
    return q.options[Math.floor(rand() * q.options.length)]!.id;
  };
  const pickQualifying = (q: QuizQuestion): string => {
    const ok = q.options.filter((o) => !o.disqualify);
    return ok[Math.floor(rand() * ok.length)]!.id;
  };
  const pickDisqualifying = (q: QuizQuestion): string | null => {
    const dq = q.options.filter((o) => o.disqualify);
    return dq.length > 0 ? dq[Math.floor(rand() * dq.length)]!.id : null;
  };

  const perBucket: RoutingSimulation['perBucket'] = {};
  for (const band of def.bands) {
    let routed = 0;
    for (let i = 0; i < perMarket; i++) {
      const answers: Record<string, string> = {};
      for (const q of routing) answers[q.id] = pickBiased(q, band.marketId);
      for (const q of prequal) answers[q.id] = pickQualifying(q);
      const result = scoreQuizAnswers(def, answers);
      if (result.bandId === band.id) routed++;
    }
    perBucket[band.id] = { intended: perMarket, routed, hitRate: perMarket === 0 ? 0 : routed / perMarket };
  }

  // Disqualified cohort: one disqualifying prequal answer each.
  let tagged = 0;
  for (let i = 0; i < dqSets; i++) {
    const answers: Record<string, string> = {};
    for (const q of routing) answers[q.id] = q.options[Math.floor(rand() * q.options.length)]!.id;
    let planted = false;
    for (const q of prequal) {
      const dq = !planted ? pickDisqualifying(q) : null;
      if (dq) {
        answers[q.id] = dq;
        planted = true;
      } else {
        answers[q.id] = pickQualifying(q);
      }
    }
    if (scoreQuizAnswers(def, answers).disqualified) tagged++;
  }

  const pass =
    Object.values(perBucket).every((b) => b.hitRate >= hitRateThreshold) && tagged === dqSets;
  return { perBucket, disqualified: { intended: dqSets, tagged }, totalSets, pass };
}
