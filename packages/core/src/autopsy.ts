import { z } from 'zod';
import { COUNCIL_LENSES } from './council.js';

/**
 * Autopsy Mode contracts (WO-047): tear down ANY funnel — theirs or a
 * prospect's. The intake takes the funnel page by page (ad → landing → VSL
 * transcript → checkout), each as a URL to auto-fetch or pasted content; the
 * Council scores the teardown and the report follows a fixed contract so the
 * share view and the Sales Detective handoff never guess at shape.
 */

export const AUTOPSY_PAGE_KINDS = ['ad', 'landing', 'vsl_transcript', 'checkout'] as const;
export type AutopsyPageKind = (typeof AUTOPSY_PAGE_KINDS)[number];

const MAX_PAGE_CHARS = 60_000;

export const autopsyPageSchema = z
  .object({
    kind: z.enum(AUTOPSY_PAGE_KINDS),
    sourceUrl: z.string().url().max(2048).optional(),
    content: z.string().trim().max(MAX_PAGE_CHARS).optional(),
  })
  .refine((p) => Boolean(p.sourceUrl) || Boolean(p.content?.length), {
    message: 'Each page needs a URL to fetch or pasted content.',
  });
export type AutopsyPage = z.infer<typeof autopsyPageSchema>;

export const autopsyIntakeSchema = z.object({
  title: z.string().trim().min(1).max(255),
  pages: z
    .array(autopsyPageSchema)
    .min(1)
    .max(AUTOPSY_PAGE_KINDS.length)
    .refine((pages) => new Set(pages.map((p) => p.kind)).size === pages.length, {
      message: 'One entry per page kind.',
    }),
});
export type AutopsyIntake = z.infer<typeof autopsyIntakeSchema>;

export function parseAutopsyIntake(data: unknown): AutopsyIntake {
  return autopsyIntakeSchema.parse(data);
}

/** Funnel-order sort for display and prompt assembly. */
export function orderAutopsyPages<T extends { kind: AutopsyPageKind }>(pages: T[]): T[] {
  const order = new Map(AUTOPSY_PAGE_KINDS.map((k, i) => [k, i]));
  return [...pages].sort((a, b) => order.get(a.kind)! - order.get(b.kind)!);
}

const AWARENESS_STAGES = ['unaware', 'problem', 'solution', 'product', 'most'] as const;

export const autopsyReportSchema = z.object({
  council_scores: z.object(
    Object.fromEntries(
      COUNCIL_LENSES.map((lens) => [
        lens,
        z.object({ score: z.number().min(0).max(100), note: z.string().trim().min(1) }),
      ]),
    ) as Record<
      (typeof COUNCIL_LENSES)[number],
      z.ZodObject<{ score: z.ZodNumber; note: z.ZodString }>
    >,
  ),
  persuasion_map: z
    .array(
      z.object({
        page: z.enum(AUTOPSY_PAGE_KINDS),
        beat: z.string().trim().min(1),
        technique: z.string().trim().min(1),
        note: z.string().trim().min(1),
      }),
    )
    .min(3),
  mismatch: z.object({
    audience_awareness: z.enum(AWARENESS_STAGES),
    funnel_assumes: z.enum(AWARENESS_STAGES),
    sophistication_market: z.number().int().min(1).max(5),
    sophistication_copy: z.number().int().min(1).max(5),
    diagnosis: z.string().trim().min(1),
  }),
  proof_gaps: z.array(
    z.object({
      claim: z.string().trim().min(1),
      gap: z.string().trim().min(1),
      severity: z.enum(['critical', 'major', 'minor']),
    }),
  ),
  offer_critique: z.object({
    strengths: z.array(z.string().trim().min(1)),
    weaknesses: z.array(z.string().trim().min(1)),
    verdict: z.string().trim().min(1),
  }),
  rewrite_priorities: z
    .array(
      z.object({
        rank: z.number().int().min(1),
        target: z.string().trim().min(1),
        why: z.string().trim().min(1),
        expected_impact: z.string().trim().min(1),
      }),
    )
    .min(1),
});
export type AutopsyReport = z.infer<typeof autopsyReportSchema>;

/** Validate a teardown; rewrite priorities must be ranked 1..n with no holes. */
export function parseAutopsyReport(data: unknown): AutopsyReport {
  const report = autopsyReportSchema.parse(data);
  const ranks = report.rewrite_priorities.map((p) => p.rank).sort((a, b) => a - b);
  ranks.forEach((rank, i) => {
    if (rank !== i + 1) throw new Error(`rewrite_priorities must rank 1..n contiguously (saw ${ranks.join(',')})`);
  });
  report.rewrite_priorities.sort((a, b) => a.rank - b.rank);
  return report;
}

/**
 * The "rebuild in CopyForge" handoff: a deterministic Sales Detective dump
 * assembled from the autopsied funnel plus the teardown's own findings, so
 * the intake extractor starts from everything the autopsy learned.
 */
export function autopsyToDumpText(
  pages: Array<{ kind: AutopsyPageKind; content?: string | null }>,
  report: AutopsyReport,
): string {
  const sections = orderAutopsyPages(pages.filter((p) => p.content?.trim().length))
    .map((p) => `## FUNNEL PAGE: ${p.kind.toUpperCase()}\n${p.content!.trim()}`);
  const critique = [
    '## AUTOPSY FINDINGS',
    `Offer verdict: ${report.offer_critique.verdict}`,
    `Offer strengths: ${report.offer_critique.strengths.join('; ') || 'none noted'}`,
    `Offer weaknesses: ${report.offer_critique.weaknesses.join('; ') || 'none noted'}`,
    `Awareness/sophistication: audience is ${report.mismatch.audience_awareness}-aware in a stage-${report.mismatch.sophistication_market} market; ${report.mismatch.diagnosis}`,
    `Rewrite priorities: ${report.rewrite_priorities.map((p) => `${p.rank}. ${p.target} — ${p.why}`).join(' ')}`,
  ].join('\n');
  return [...sections, critique].join('\n\n');
}
