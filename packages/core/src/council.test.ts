import { describe, expect, it } from 'vitest';
import {
  aggregateCouncil,
  clampWeights,
  composeRevisionNotes,
  COUNCIL_LENSES,
  DEFAULT_COUNCIL_CONFIG,
  parseLensResult,
  type CouncilLens,
  type LensResult,
} from './council.js';

const result = (score: number, verdict: 'pass' | 'revise' = score >= 80 ? 'pass' : 'revise'): LensResult => ({
  score,
  verdict,
  top_fixes: verdict === 'revise' ? [`raise score from ${score}`] : [],
  line_notes: verdict === 'revise' ? [{ block_id: 'b1', note: `weak at ${score}` }] : [],
});

const all = (score: number): Record<CouncilLens, LensResult> =>
  Object.fromEntries(COUNCIL_LENSES.map((l) => [l, result(score)])) as Record<CouncilLens, LensResult>;

describe('council aggregation (WO-020 / §5 G3)', () => {
  it('passes at aggregate ≥80 with no lens below 70', () => {
    const verdict = aggregateCouncil(all(85));
    expect(verdict.pass).toBe(true);
    expect(verdict.aggregate).toBe(85);
    expect(verdict.failingLenses).toEqual([]);
  });

  it('boundary: exactly 80 aggregate and exactly 70 floor pass', () => {
    const results = all(80);
    results.carlton = result(70, 'pass');
    results.schwartz = result(90, 'pass');
    // mean = (80*4 + 70 + 90)/6 = 80
    const verdict = aggregateCouncil(results);
    expect(verdict.aggregate).toBe(80);
    expect(verdict.pass).toBe(true);
  });

  it('one lens below 70 fails regardless of a high aggregate', () => {
    const results = all(95);
    results.kennedy = result(69);
    const verdict = aggregateCouncil(results);
    expect(verdict.aggregate).toBeGreaterThan(80);
    expect(verdict.pass).toBe(false);
    expect(verdict.belowFloor).toEqual(['kennedy']);
    expect(verdict.failingLenses).toContain('kennedy');
  });

  it('aggregate below threshold fails even with all lenses above floor', () => {
    const verdict = aggregateCouncil(all(75));
    expect(verdict.pass).toBe(false);
    expect(verdict.failingLenses.length).toBe(6);
  });

  it('weights shift the aggregate but are clamped to ±20% and never move floors', () => {
    const results = all(78);
    results.schwartz = result(95, 'pass');
    const base = aggregateCouncil(results).aggregate;
    const weighted = aggregateCouncil(results, {
      ...DEFAULT_COUNCIL_CONFIG,
      weights: { ...DEFAULT_COUNCIL_CONFIG.weights, schwartz: 5 }, // clamped to 1.2
    }).aggregate;
    expect(weighted).toBeGreaterThan(base);
    const clamped = clampWeights({ schwartz: 5, halbert: 0.1 });
    expect(clamped.schwartz).toBe(1.2);
    expect(clamped.halbert).toBe(0.8);

    // Floors immune to weighting: a below-floor lens still fails.
    const withFloor = all(95);
    withFloor.halbert = result(69);
    const verdict = aggregateCouncil(withFloor, {
      ...DEFAULT_COUNCIL_CONFIG,
      weights: { ...DEFAULT_COUNCIL_CONFIG.weights, halbert: 0.0001 }, // clamped to 0.8
    });
    expect(verdict.pass).toBe(false);
  });

  it('throws on a missing lens', () => {
    const partial = all(90) as Partial<Record<CouncilLens, LensResult>>;
    delete partial.sugarman;
    expect(() => aggregateCouncil(partial as Record<CouncilLens, LensResult>)).toThrow(/sugarman/);
  });
});

describe('revision brief composition', () => {
  it('contains ONLY the failing lenses, with their fixes and line notes', () => {
    const results = all(90);
    results.carlton = result(60);
    results.sugarman = result(65);
    const verdict = aggregateCouncil(results);
    const brief = composeRevisionNotes(results, verdict.failingLenses);
    expect(brief).toContain('CARLTON');
    expect(brief).toContain('SUGARMAN');
    expect(brief).toContain('weak at 60');
    expect(brief).not.toContain('SCHWARTZ');
    expect(brief).not.toContain('KENNEDY');
    expect(brief).not.toContain('BENCIVENGA');
    expect(brief).not.toContain('HALBERT');
  });

  it('is empty when nothing fails', () => {
    expect(composeRevisionNotes(all(90), [])).toBe('');
  });
});

describe('lens result contract', () => {
  it('parses valid results and rejects malformed ones', () => {
    const ok = parseLensResult({ score: 82, verdict: 'pass', top_fixes: [], line_notes: [] });
    expect(ok.score).toBe(82);
    expect(() => parseLensResult({ score: 101, verdict: 'pass' })).toThrow();
    expect(() => parseLensResult({ score: 50, verdict: 'maybe' })).toThrow();
    expect(() =>
      parseLensResult({ score: 50, verdict: 'revise', top_fixes: ['a', 'b', 'c', 'd'] }),
    ).toThrow();
  });
});
