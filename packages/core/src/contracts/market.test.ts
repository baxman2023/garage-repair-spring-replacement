import { describe, expect, it } from 'vitest';
import {
  parseMarketSelectionResult,
  rankCandidates,
  scoreMarket,
  STARVING_CROWD_WEIGHTS,
} from './market.js';

const candidate = (label: string, scores: Partial<Record<string, number>> = {}) => ({
  label,
  avatar_hint: 'someone',
  rationale: 'a starving crowd',
  scores: {
    pain: 5,
    purchasing_power: 5,
    reachability: 5,
    urgency: 5,
    ltv: 5,
    ...scores,
  },
});

describe('starving-crowd scoring (WO-012)', () => {
  it('weights sum to 1', () => {
    const sum = Object.values(STARVING_CROWD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('scores on a 0–100 scale with the config weights', () => {
    expect(scoreMarket(candidate('x').scores)).toBe(50);
    expect(scoreMarket(candidate('max', { pain: 10, purchasing_power: 10, reachability: 10, urgency: 10, ltv: 10 }).scores)).toBe(100);
    // pain weight 0.25: raising pain 5→10 adds 12.5 points
    expect(scoreMarket(candidate('p', { pain: 10 }).scores)).toBe(62.5);
  });

  it('ranks candidates by weighted total, stable on ties', () => {
    const ranked = rankCandidates([
      candidate('mid'),
      candidate('high', { pain: 10, urgency: 10 }),
      candidate('tie-first'),
      candidate('low', { pain: 1, ltv: 1 }),
    ]);
    expect(ranked.map((r) => r.label)).toEqual(['high', 'mid', 'tie-first', 'low']);
    expect(ranked[0]!.total).toBeGreaterThan(ranked[3]!.total);
  });

  it('contract requires 8–12 candidates with bounded scores', () => {
    const eight = Array.from({ length: 8 }, (_v, i) => candidate(`c${i}`));
    expect(parseMarketSelectionResult({ candidates: eight }).candidates.length).toBe(8);
    expect(() => parseMarketSelectionResult({ candidates: eight.slice(0, 7) })).toThrow();
    expect(() =>
      parseMarketSelectionResult({ candidates: Array.from({ length: 13 }, (_v, i) => candidate(`c${i}`)) }),
    ).toThrow();
    expect(() =>
      parseMarketSelectionResult({ candidates: [...eight.slice(0, 7), candidate('bad', { pain: 11 })] }),
    ).toThrow();
  });
});
