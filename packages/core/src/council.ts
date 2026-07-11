import { z } from 'zod';

/**
 * Council of Copywriters — pure aggregation (spec §6 / WO-020).
 * Six lenses each return a scored verdict; G3 passes when the weighted
 * aggregate ≥ threshold AND no lens sits below the floor. Calibration
 * (WO-045) may adjust per-lens weights ±20% — floors NEVER move.
 */

export const COUNCIL_LENSES = [
  'schwartz',
  'halbert',
  'bencivenga',
  'sugarman',
  'kennedy',
  'carlton',
] as const;
export type CouncilLens = (typeof COUNCIL_LENSES)[number];

export const lensResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(['pass', 'revise']),
  top_fixes: z.array(z.string().trim().min(1)).max(3).default([]),
  line_notes: z
    .array(z.object({ block_id: z.string().default(''), note: z.string().trim().min(1) }))
    .default([]),
});
export type LensResult = z.infer<typeof lensResultSchema>;

export function parseLensResult(data: unknown): LensResult {
  return lensResultSchema.parse(data);
}

export interface CouncilConfig {
  /** G3 aggregate threshold (spec §5 default 80). */
  aggregateThreshold: number;
  /** Per-lens floor (spec §5 default 70). Never adjusted by calibration. */
  lensFloor: number;
  /** Per-lens weights; calibration may move them within ±20% of 1. */
  weights: Record<CouncilLens, number>;
}

export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  aggregateThreshold: 80,
  lensFloor: 70,
  weights: {
    schwartz: 1,
    halbert: 1,
    bencivenga: 1,
    sugarman: 1,
    kennedy: 1,
    carlton: 1,
  },
};

/** Calibration bound (spec §6): weights live in [0.8, 1.2]. */
export const WEIGHT_MIN = 0.8;
export const WEIGHT_MAX = 1.2;

/** Clamp calibration weights into the ±20% band. Floors are untouchable. */
export function clampWeights(weights: Partial<Record<CouncilLens, number>>): Record<CouncilLens, number> {
  const out = { ...DEFAULT_COUNCIL_CONFIG.weights };
  for (const lens of COUNCIL_LENSES) {
    const w = weights[lens];
    if (typeof w === 'number' && Number.isFinite(w)) {
      out[lens] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w));
    }
  }
  return out;
}

export interface CouncilVerdict {
  aggregate: number;
  pass: boolean;
  /** Lenses that must drive the revision (spec: notes ONLY from these). */
  failingLenses: CouncilLens[];
  /** Lenses below the hard floor (forces failure regardless of aggregate). */
  belowFloor: CouncilLens[];
}

/** Weighted-mean aggregate + G3 verdict. Pure. */
export function aggregateCouncil(
  results: Record<CouncilLens, LensResult>,
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG,
): CouncilVerdict {
  const weights = clampWeights(config.weights);
  let weightedSum = 0;
  let weightTotal = 0;
  for (const lens of COUNCIL_LENSES) {
    const result = results[lens];
    if (!result) throw new Error(`Missing lens result: ${lens}`);
    weightedSum += result.score * weights[lens];
    weightTotal += weights[lens];
  }
  const aggregate = Math.round((weightedSum / weightTotal) * 100) / 100;

  const belowFloor = COUNCIL_LENSES.filter((l) => results[l].score < config.lensFloor);
  const pass = aggregate >= config.aggregateThreshold && belowFloor.length === 0;

  // Failing = lenses that themselves demanded revision (verdict) or broke the
  // floor. Only when NONE did but the aggregate still fails do we fall back to
  // the lenses dragging it under the threshold — the brief stays focused.
  const primary = COUNCIL_LENSES.filter(
    (l) => results[l].verdict === 'revise' || results[l].score < config.lensFloor,
  );
  const failingLenses = pass
    ? []
    : primary.length > 0
      ? primary
      : COUNCIL_LENSES.filter((l) => results[l].score < config.aggregateThreshold);

  return { aggregate, pass, failingLenses, belowFloor };
}

/**
 * Compose the revision brief from ONLY the failing lenses' notes (spec §6).
 * Passing lenses' opinions are deliberately excluded.
 */
export function composeRevisionNotes(
  results: Record<CouncilLens, LensResult>,
  failingLenses: CouncilLens[],
): string {
  if (failingLenses.length === 0) return '';
  const sections = failingLenses.map((lens) => {
    const r = results[lens];
    const fixes = r.top_fixes.map((f) => `- ${f}`).join('\n');
    const notes = r.line_notes.map((n) => `- [block ${n.block_id || '?'}] ${n.note}`).join('\n');
    return [
      `${lens.toUpperCase()} (scored ${r.score}):`,
      fixes ? `Top fixes:\n${fixes}` : '',
      notes ? `Line notes:\n${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    'REVISION BRIEF — address ONLY the following failing-lens critiques. Do not water down what the passing lenses praised.',
    ...sections,
  ].join('\n\n');
}
