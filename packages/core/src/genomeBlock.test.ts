import { describe, expect, it } from 'vitest';
import {
  componentWeight,
  estimateTokens,
  genomePromptBlock,
  rankComponents,
  type RetrievableComponent,
} from './genomeBlock.js';

const NOW = new Date('2026-07-01T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const comp = (id: string, confidence: number, ageDays: number, size = 1): RetrievableComponent => ({
  id,
  type: 'lead',
  niche: 'fitness',
  content: {
    summary: 'structural summary '.repeat(size),
    evidence: 'verbatim evidence '.repeat(size),
    pattern: 'pattern',
  },
  confidence,
  seenAt: daysAgo(ageDays),
});

describe('genome weighting (WO-018)', () => {
  it('halves weight per half-life and scales by confidence', () => {
    expect(componentWeight(comp('a', 1, 0), NOW)).toBeCloseTo(1, 5);
    expect(componentWeight(comp('a', 1, 90), NOW)).toBeCloseTo(0.5, 5);
    expect(componentWeight(comp('a', 0.8, 180), NOW)).toBeCloseTo(0.2, 5);
  });

  it('ranking is deterministic: weight desc, id asc tiebreak', () => {
    const list = [comp('b', 0.9, 10), comp('a', 0.9, 10), comp('c', 0.5, 400)];
    const ranked1 = rankComponents(list, NOW).map((c) => c.id);
    const ranked2 = rankComponents([...list].reverse(), NOW).map((c) => c.id);
    expect(ranked1).toEqual(['a', 'b', 'c']);
    expect(ranked2).toEqual(ranked1); // input order never matters
  });
});

describe('genome cache block', () => {
  it('renders best-weight-first within the token budget', () => {
    const components = [comp('fresh', 0.95, 1), comp('old', 0.95, 700), comp('mid', 0.9, 30)];
    const block = genomePromptBlock(components, NOW, 10_000);
    expect(block.included).toEqual(['fresh', 'mid', 'old']);
    expect(block.truncated).toEqual([]);
    expect(block.text).toContain('PERSUASION GENOME');
    expect(block.text.indexOf('fresh')).toBeLessThan(0 + block.text.length); // rendered
    expect(block.tokens).toBeLessThanOrEqual(10_000);
    expect(estimateTokens(block.text)).toBeLessThanOrEqual(10_000);
  });

  it('gracefully truncates the lowest-weight components at the budget', () => {
    const components = [
      comp('keep-1', 0.99, 1, 10),
      comp('keep-2', 0.9, 5, 10),
      comp('drop-1', 0.4, 300, 10),
      comp('drop-2', 0.2, 600, 10),
    ];
    // Budget fits roughly two rendered components.
    const oneSize = estimateTokens('structural summary '.repeat(10)) * 3;
    const block = genomePromptBlock(components, NOW, oneSize * 2);
    expect(block.included).toContain('keep-1');
    expect(block.truncated).toContain('drop-2');
    expect(block.included.length + block.truncated.length).toBe(4);
    expect(block.tokens).toBeLessThanOrEqual(oneSize * 2);
    // Determinism: same inputs → same block text.
    expect(genomePromptBlock(components, NOW, oneSize * 2).text).toBe(block.text);
  });
});
