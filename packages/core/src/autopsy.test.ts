import { describe, expect, it } from 'vitest';
import {
  autopsyToDumpText,
  orderAutopsyPages,
  parseAutopsyIntake,
  parseAutopsyReport,
  type AutopsyReport,
} from './autopsy.js';

export function fixtureReport(over: Partial<AutopsyReport> = {}): AutopsyReport {
  return {
    council_scores: {
      schwartz: { score: 62, note: 'Writes to solution-aware; traffic is problem-aware.' },
      halbert: { score: 55, note: 'Hook buried under branding.' },
      bencivenga: { score: 40, note: 'Claims outrun proof everywhere.' },
      sugarman: { score: 70, note: 'Readable but the slide stalls at the offer.' },
      kennedy: { score: 48, note: 'No deadline, no reason to respond today.' },
      carlton: { score: 66, note: 'Voice is fine; the lead is limp.' },
    },
    persuasion_map: [
      { page: 'ad', beat: 'curiosity hook', technique: 'open loop', note: 'Lands, but promises a secret the landing page never pays off.' },
      { page: 'landing', beat: 'problem agitation', technique: 'PAS', note: 'Two paragraphs, then leaps to the pitch.' },
      { page: 'vsl_transcript', beat: 'mechanism reveal', technique: 'unique mechanism', note: 'Named but never differentiated.' },
      { page: 'checkout', beat: 'risk reversal', technique: 'guarantee', note: 'Thirty-day guarantee stated in the footer only.' },
    ],
    mismatch: {
      audience_awareness: 'problem',
      funnel_assumes: 'product',
      sophistication_market: 4,
      sophistication_copy: 2,
      diagnosis: 'The ad recruits problem-aware homeowners but the landing page opens on the brand name; a stage-four market is being pitched stage-two claims.',
    },
    proof_gaps: [
      { claim: 'Fixed same day or free', gap: 'No policy terms, no example, no count of honored claims.', severity: 'critical' },
      { claim: 'Rated best in the county', gap: 'No source for the rating.', severity: 'major' },
    ],
    offer_critique: {
      strengths: ['Free inspection lowers entry friction'],
      weaknesses: ['No urgency device', 'Guarantee hidden at checkout'],
      verdict: 'A decent service offer wearing no clothes: the value is real but nothing makes today the day.',
    },
    rewrite_priorities: [
      { rank: 1, target: 'landing headline', why: 'Awareness mismatch is the largest leak.', expected_impact: 'Aligns the page with problem-aware traffic.' },
      { rank: 2, target: 'checkout risk reversal', why: 'The guarantee is the strongest proof asset and it is hidden.', expected_impact: 'Moves the decision from trust to logistics.' },
    ],
    ...over,
  };
}

describe('autopsy contracts (WO-047)', () => {
  it('intake requires content or URL per page and unique kinds', () => {
    expect(() =>
      parseAutopsyIntake({ title: 'T', pages: [{ kind: 'landing', content: 'copy here' }] }),
    ).not.toThrow();
    expect(() => parseAutopsyIntake({ title: 'T', pages: [{ kind: 'landing' }] })).toThrow();
    expect(() =>
      parseAutopsyIntake({
        title: 'T',
        pages: [
          { kind: 'landing', content: 'a' },
          { kind: 'landing', content: 'b' },
        ],
      }),
    ).toThrow(/One entry per page kind/);
    expect(() => parseAutopsyIntake({ title: '', pages: [{ kind: 'ad', content: 'x' }] })).toThrow();
  });

  it('orders pages in funnel order regardless of input order', () => {
    const ordered = orderAutopsyPages([
      { kind: 'checkout' as const },
      { kind: 'ad' as const },
      { kind: 'vsl_transcript' as const },
      { kind: 'landing' as const },
    ]);
    expect(ordered.map((p) => p.kind)).toEqual(['ad', 'landing', 'vsl_transcript', 'checkout']);
  });

  it('accepts the fixture report and sorts rewrite priorities by rank', () => {
    const shuffled = fixtureReport();
    shuffled.rewrite_priorities.reverse();
    const parsed = parseAutopsyReport(shuffled);
    expect(parsed.rewrite_priorities.map((p) => p.rank)).toEqual([1, 2]);
    expect(Object.keys(parsed.council_scores)).toHaveLength(6);
  });

  it('rejects non-contiguous rewrite ranks and missing sections', () => {
    const gappy = fixtureReport();
    gappy.rewrite_priorities = [
      { rank: 1, target: 'x', why: 'y', expected_impact: 'z' },
      { rank: 3, target: 'x', why: 'y', expected_impact: 'z' },
    ];
    expect(() => parseAutopsyReport(gappy)).toThrow(/contiguously/);

    const { mismatch: _dropped, ...noMismatch } = fixtureReport();
    expect(() => parseAutopsyReport(noMismatch)).toThrow();

    const thin = fixtureReport();
    thin.persuasion_map = thin.persuasion_map.slice(0, 2); // < 3 beats
    expect(() => parseAutopsyReport(thin)).toThrow();
  });

  it('builds the Sales Detective dump from pages + findings, in funnel order', () => {
    const report = fixtureReport();
    const dump = autopsyToDumpText(
      [
        { kind: 'checkout', content: 'Order page: $499 spring replacement.' },
        { kind: 'landing', content: 'Landing: Garage door stuck? We fix it today.' },
        { kind: 'ad', content: null },
      ],
      report,
    );
    expect(dump.indexOf('FUNNEL PAGE: LANDING')).toBeLessThan(dump.indexOf('FUNNEL PAGE: CHECKOUT'));
    expect(dump).not.toContain('FUNNEL PAGE: AD'); // no content → omitted
    expect(dump).toContain('## AUTOPSY FINDINGS');
    expect(dump).toContain('Offer verdict: A decent service offer');
    expect(dump).toContain('1. landing headline');
  });
});
