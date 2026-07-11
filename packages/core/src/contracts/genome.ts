import { z } from 'zod';

/**
 * Persuasion Genome decomposition (WO-017). Swipes are stored as tagged
 * structural components, not blobs. Parsing is deliberately tolerant: valid
 * typed components are kept, junk is counted and dropped, and the typed
 * ratio is reported so the ≥90%-typed acceptance is measurable.
 */

export const GENOME_COMPONENT_TYPES = [
  'lead',
  'mechanism_name',
  'proof_stack',
  'price_reveal',
  'close',
  'bullet_style',
  'headline_pattern',
] as const;
export type GenomeComponentType = (typeof GENOME_COMPONENT_TYPES)[number];

export const genomeComponentSchema = z.object({
  type: z.enum(GENOME_COMPONENT_TYPES),
  content: z.object({
    /** What the component does, structurally. */
    summary: z.string().trim().min(1),
    /** Verbatim excerpt from the swipe demonstrating it. */
    evidence: z.string().trim().min(1),
    /** Optional named pattern (e.g. "if-then bullet", "damaging admission"). */
    pattern: z.string().default(''),
  }),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()).default([]),
});
export type GenomeComponent = z.infer<typeof genomeComponentSchema>;

const decompositionEnvelopeSchema = z.object({
  niche: z.string().default(''),
  channel: z.string().default(''),
  awareness: z.enum(['unaware', 'problem', 'solution', 'product', 'most']).nullable().default(null),
  components: z.array(z.unknown()).min(1),
});

export interface GenomeDecomposition {
  niche: string;
  channel: string;
  awareness: 'unaware' | 'problem' | 'solution' | 'product' | 'most' | null;
  components: GenomeComponent[];
  /** Entries the model emitted that failed the component contract. */
  dropped: number;
  /** components / (components + dropped). */
  typedRatio: number;
}

/** Parse a decomposition, keeping valid components and counting the rest. */
export function parseGenomeDecomposition(data: unknown): GenomeDecomposition {
  const envelope = decompositionEnvelopeSchema.parse(data);
  const components: GenomeComponent[] = [];
  let dropped = 0;
  for (const raw of envelope.components) {
    const result = genomeComponentSchema.safeParse(raw);
    if (result.success) components.push(result.data);
    else dropped++;
  }
  if (components.length === 0) {
    throw new Error('Decomposition contained no valid typed components.');
  }
  const total = components.length + dropped;
  return {
    niche: envelope.niche,
    channel: envelope.channel,
    awareness: envelope.awareness,
    components,
    dropped,
    typedRatio: components.length / total,
  };
}
