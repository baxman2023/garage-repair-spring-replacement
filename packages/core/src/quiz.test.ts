import { describe, expect, it } from 'vitest';
import {
  scoreQuizAnswers,
  simulateRouting,
  validateQuizDefinition,
  type QuizDefinition,
  type QuizQuestion,
} from './contracts/quiz.js';

const M = (n: number) => `${String(n).repeat(25)}M`.slice(0, 26); // fake 26-char ids
const MARKETS = [M(1), M(2), M(3), M(4), M(5)];

/** 6 routing questions; option i strongly signals market i. */
const routingQuestion = (n: number): QuizQuestion => ({
  id: `q${n}`,
  kind: 'routing',
  text: `Routing question ${n}?`,
  options: MARKETS.map((marketId, i) => ({
    id: `q${n}-o${i + 1}`,
    text: `Option ${i + 1}`,
    weights: { [marketId]: 3, [MARKETS[(i + 1) % 5]!]: 1 },
    disqualify: false,
  })),
});

const PREQUAL: QuizQuestion = {
  id: 'budget',
  kind: 'prequal',
  text: 'What is your budget?',
  options: [
    { id: 'budget-ready', text: 'Ready to invest', weights: {}, disqualify: false },
    { id: 'budget-some', text: 'Some budget', weights: {}, disqualify: false },
    { id: 'budget-none', text: 'Just browsing, no budget', weights: {}, disqualify: true },
  ],
};

const DEF: QuizDefinition = {
  slug: 'quiz-fixture',
  questions: [...Array.from({ length: 6 }, (_v, i) => routingQuestion(i + 1)), PREQUAL],
  scoring: {
    method: 'weighted_sum',
    lead_capture: { headline: 'Your diagnosis is ready', button: 'Send it', fields: ['email'] },
    decline: { headline: 'We are not the right fit today', body: 'Here is a free guide instead.' },
  },
  bands: MARKETS.map((marketId, i) => ({
    id: `band-${i + 1}`,
    marketId,
    label: `Bucket ${i + 1}`,
    resultBlocks: [
      { id: 'hl', role: 'headline', text: `Result for bucket ${i + 1}` },
      { id: 'cta', role: 'cta', text: 'Book the fix' },
    ],
  })),
};

describe('quiz scoring (WO-039)', () => {
  it('weighted sum routes to the top market; ties break by band order', () => {
    const answers: Record<string, string> = { budget: 'budget-ready' };
    for (let i = 1; i <= 6; i++) answers[`q${i}`] = `q${i}-o3`; // all signal market 3
    const result = scoreQuizAnswers(DEF, answers);
    expect(result.disqualified).toBe(false);
    expect(result.marketId).toBe(MARKETS[2]);
    expect(result.bandId).toBe('band-3');
    expect(result.totals[MARKETS[2]!]).toBe(18); // 6 × 3

    // Genuine tie between markets 1 and 2 (4 points each) → band order wins.
    // q1-o1: M1+3 M2+1 · q2-o2: M2+3 M3+1 · q3-o5: M5+3 M1+1.
    const tied = { q1: 'q1-o1', q2: 'q2-o2', q3: 'q3-o5', budget: 'budget-some' };
    const tiedResult = scoreQuizAnswers(DEF, tied);
    expect(tiedResult.totals[MARKETS[0]!]).toBe(tiedResult.totals[MARKETS[1]!]);
    expect(tiedResult.bandId).toBe('band-1');
  });

  it('any disqualifying option tags the respondent (no band)', () => {
    const answers: Record<string, string> = { budget: 'budget-none' };
    for (let i = 1; i <= 6; i++) answers[`q${i}`] = `q${i}-o1`;
    const result = scoreQuizAnswers(DEF, answers);
    expect(result.disqualified).toBe(true);
    expect(result.bandId).toBeNull();
  });

  it('rejects an answer that is not one of the question options', () => {
    expect(() => scoreQuizAnswers(DEF, { q1: 'nope' })).toThrow(/not an option/);
  });
});

describe('quiz validation', () => {
  it('accepts the fixture; rejects structural violations', () => {
    expect(() => validateQuizDefinition(DEF)).not.toThrow();

    const tooFew = { ...DEF, questions: [routingQuestion(1), routingQuestion(2), PREQUAL] };
    expect(() => validateQuizDefinition(tooFew)).toThrow(/5-8 routing questions/);

    const noDq = {
      ...DEF,
      questions: [
        ...DEF.questions.filter((q) => q.kind === 'routing'),
        { ...PREQUAL, options: PREQUAL.options.map((o) => ({ ...o, disqualify: false })) },
      ],
    };
    expect(() => validateQuizDefinition(noDq)).toThrow(/must disqualify/);

    const unknownMarket = structuredClone(DEF);
    unknownMarket.questions[0]!.options[0]!.weights = { ['X'.repeat(26)]: 3 };
    expect(() => validateQuizDefinition(unknownMarket)).toThrow(/unknown market/);

    // Market 5 unreachable: strip it from every option's weights.
    const unreachable = structuredClone(DEF);
    for (const q of unreachable.questions) {
      for (const o of q.options) delete o.weights[MARKETS[4]!];
    }
    expect(() => validateQuizDefinition(unreachable)).toThrow(/unreachable/);
  });
});

describe('routing simulator — 1,000 synthetic answer sets (acceptance)', () => {
  it('distributes to the expected buckets and tags every disqualified set', () => {
    const sim = simulateRouting(DEF, 1000);
    expect(sim.pass).toBe(true);
    for (const bucket of Object.values(sim.perBucket)) {
      expect(bucket.hitRate).toBeGreaterThanOrEqual(0.7);
    }
    expect(sim.disqualified.tagged).toBe(sim.disqualified.intended);
    expect(sim.disqualified.intended).toBe(100); // 10% of 1,000
  });

  it('is deterministic (seeded) and fails on sabotaged weights', () => {
    expect(simulateRouting(DEF, 1000, 42)).toEqual(simulateRouting(DEF, 1000, 42));

    // Sabotage: every option's strongest signal points at market 1 —
    // structural validation still passes (others keep weak weights top
    // somewhere? no — make others weak but present), routing collapses.
    const sabotaged = structuredClone(DEF);
    for (const q of sabotaged.questions.filter((x) => x.kind === 'routing')) {
      for (const o of q.options) {
        o.weights = { [MARKETS[0]!]: 3, ...Object.fromEntries(Object.entries(o.weights).map(([k, v]) => [k, Math.min(v, 1)])) };
        o.weights[MARKETS[0]!] = 3;
      }
    }
    const sim = simulateRouting(sabotaged, 1000);
    expect(sim.pass).toBe(false);
  });
});
