/**
 * Genome retrieval weighting + cache-block rendering (WO-018 / spec §1.2
 * block 2). Pure and deterministic: given the same components and `now`,
 * ordering and truncation never change.
 */

export interface RetrievableComponent {
  id: string;
  type: string;
  niche: string | null;
  content: { summary?: string; evidence?: string; pattern?: string } & Record<string, unknown>;
  confidence: number;
  /** Recency anchor: last_seen, else created_at. */
  seenAt: Date;
}

/** Recency half-life for weighting (days). Config default. */
export const GENOME_RECENCY_HALF_LIFE_DAYS = 90;

/** Default token budget for the rendered block. Config default. */
export const GENOME_BLOCK_TOKEN_BUDGET = 4000;

/** weight = confidence × 2^(−ageDays / halfLife); deterministic given `now`. */
export function componentWeight(
  component: Pick<RetrievableComponent, 'confidence' | 'seenAt'>,
  now: Date,
  halfLifeDays: number = GENOME_RECENCY_HALF_LIFE_DAYS,
): number {
  const ageDays = Math.max(0, (now.getTime() - component.seenAt.getTime()) / 86_400_000);
  return component.confidence * 2 ** (-ageDays / halfLifeDays);
}

/** Stable ordering: weight desc, id asc as the deterministic tiebreak. */
export function rankComponents<T extends RetrievableComponent>(
  components: T[],
  now: Date,
  halfLifeDays?: number,
): Array<T & { weight: number }> {
  return components
    .map((c) => ({ ...c, weight: componentWeight(c, now, halfLifeDays) }))
    .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Rough token estimate (chars/4) — the standard planning approximation. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderComponent(c: RetrievableComponent & { weight: number }): string {
  const lines = [
    `[${c.type}${c.niche ? ` · ${c.niche}` : ''}] ${c.content.pattern || ''}`.trim(),
    `  ${c.content.summary ?? ''}`,
    c.content.evidence ? `  e.g. "${c.content.evidence}"` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

const HEADER =
  'PERSUASION GENOME — proven structural components (adapt the structure, never copy the surface):';

export interface GenomeBlockResult {
  text: string;
  included: string[];
  truncated: string[];
  tokens: number;
}

/**
 * Render the genome cache block within `tokenBudget`. Components are added
 * best-weight-first; when the budget is hit, the remaining (lowest-weight)
 * components are gracefully truncated and reported.
 */
export function genomePromptBlock(
  components: RetrievableComponent[],
  now: Date,
  tokenBudget: number = GENOME_BLOCK_TOKEN_BUDGET,
): GenomeBlockResult {
  const ranked = rankComponents(components, now);
  const included: string[] = [];
  const truncated: string[] = [];
  const parts: string[] = [HEADER];
  let tokens = estimateTokens(HEADER);

  for (const component of ranked) {
    const rendered = renderComponent(component);
    const cost = estimateTokens(rendered) + 1;
    if (tokens + cost > tokenBudget) {
      truncated.push(component.id);
      continue;
    }
    parts.push(rendered);
    tokens += cost;
    included.push(component.id);
  }

  return { text: parts.join('\n\n'), included, truncated, tokens };
}
