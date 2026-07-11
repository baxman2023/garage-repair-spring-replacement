import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESLOP_CONFIG,
  evaluateDeslop,
  extractNumberTokens,
  findInventedNumbers,
  fleschKincaidGrade,
  measureDeslop,
  sentenceRhythm,
  specificityDensity,
  SPOKEN_ASSET_TYPES,
} from './deslop.js';

/** WO-030 fixture: the sloppy AI draft (tells, uniform rhythm, grade ~16, zero specifics). */
export const SLOPPY_FIXTURE = `In today's world, garage door maintenance is something that homeowners frequently delve into without fully understanding the complexities involved in the mechanical systems. Navigating the complexities of torsion spring replacement requires a comprehensive understanding of the underlying engineering principles that govern the operation. It is important to note that professional intervention is generally recommended for these situations. Furthermore, the associated risks are considerable and should not be underestimated by anyone.`;

/** The de-slopped rewrite: grade in band, zero tells, dense specifics, varied rhythm. */
export const CLEAN_FIXTURE = `The bang woke Dan at six in the morning, and his garage door refused to move an inch. The spring had snapped overnight, leaving the family car trapped inside on the morning of his most important meeting. Here is the part nobody mentions. Standard torsion springs are rated ten thousand cycles by the independent testing lab, and a busy household door burns through that allowance in about seven years. Ours is different. The SpringGuard replacement coil is engineered and certified for double the standard rating, and the complete installation costs three hundred forty nine dollars. One visit. Finished before lunch. Book the appointment today and forget the door entirely.`;

describe('Flesch-Kincaid grade (WO-030)', () => {
  it('scores simple copy low and academic sludge high', () => {
    expect(fleschKincaidGrade('The dog ran. The cat sat. It was fun.')).toBeLessThan(3);
    expect(fleschKincaidGrade(SLOPPY_FIXTURE)).toBeGreaterThan(12);
    const clean = fleschKincaidGrade(CLEAN_FIXTURE);
    expect(clean).toBeGreaterThanOrEqual(5);
    expect(clean).toBeLessThanOrEqual(8);
  });
});

describe('specificity density', () => {
  it('counts numbers, units, and proper nouns per 100 words', () => {
    expect(specificityDensity(SLOPPY_FIXTURE)).toBe(0);
    expect(specificityDensity(CLEAN_FIXTURE)).toBeGreaterThan(DEFAULT_DESLOP_CONFIG.minSpecificityDensity);
    expect(specificityDensity('It costs $349 and takes 45 minutes with Dan.')).toBeGreaterThan(20);
  });
});

describe('sentence rhythm', () => {
  it('flags uniform rhythm, rewards variance', () => {
    expect(sentenceRhythm(SLOPPY_FIXTURE).variance).toBeLessThan(DEFAULT_DESLOP_CONFIG.minRhythmVariance);
    expect(sentenceRhythm(CLEAN_FIXTURE).variance).toBeGreaterThan(DEFAULT_DESLOP_CONFIG.minRhythmVariance);
  });
});

describe('invented-specifics guard (WO-030 acceptance)', () => {
  const corpus = 'rated ten thousand cycles\ncosts $349 installed\nabout seven years, six in the morning, one visit, 20000';

  it('maps digits to spoken forms — $349 in the corpus allows "three hundred forty nine dollars"', () => {
    expect(extractNumberTokens('costs $349')).toContain('three hundred forty nine');
    expect(findInventedNumbers('It costs three hundred forty nine dollars.', corpus)).toEqual([]);
  });

  it('flags numbers absent from the corpus', () => {
    expect(findInventedNumbers('Over 97 percent of doors fail early.', corpus)).toContain('97');
    expect(findInventedNumbers('Twelve thousand happy customers.', corpus)).not.toEqual([]);
  });

  it('the clean fixture invents nothing against its source corpus', () => {
    expect(findInventedNumbers(CLEAN_FIXTURE, `${corpus}\ndouble the standard rating`)).toEqual([]);
  });
});

describe('evaluateDeslop — §5 G5 verdict', () => {
  it('sloppy fixture fails on every dimension; clean fixture passes (acceptance)', () => {
    const sloppy = evaluateDeslop({ metrics: measureDeslop(SLOPPY_FIXTURE), spoken: false, hasVoiceSamples: false });
    expect(sloppy.pass).toBe(false);
    expect(sloppy.failures.join(' ')).toMatch(/Readability grade/);
    expect(sloppy.failures.join(' ')).toMatch(/AI-tell hits/);
    expect(sloppy.failures.join(' ')).toMatch(/Specificity density/);
    expect(sloppy.failures.join(' ')).toMatch(/rhythm too uniform/);

    const clean = evaluateDeslop({ metrics: measureDeslop(CLEAN_FIXTURE), spoken: false, hasVoiceSamples: false });
    expect(clean.pass).toBe(true);
    expect(clean.metrics.tells).toEqual([]); // zero tell hits
  });

  it('spoken assets use the tighter 5-7 band', () => {
    expect(SPOKEN_ASSET_TYPES.has('vsl')).toBe(true);
    expect(SPOKEN_ASSET_TYPES.has('sales_letter')).toBe(false);
    const metrics = measureDeslop(CLEAN_FIXTURE); // grade ~7.2
    expect(evaluateDeslop({ metrics, spoken: false, hasVoiceSamples: false }).pass).toBe(true);
    const spoken = evaluateDeslop({ metrics, spoken: true, hasVoiceSamples: false });
    expect(spoken.pass).toBe(false); // 7.2 > 7
    expect(spoken.band).toEqual([5, 7]);
  });

  it('voice-match gates only when samples exist; thresholds are config-driven', () => {
    const metrics = measureDeslop(CLEAN_FIXTURE, 40);
    expect(evaluateDeslop({ metrics, spoken: false, hasVoiceSamples: false }).pass).toBe(true);
    const withSamples = evaluateDeslop({ metrics, spoken: false, hasVoiceSamples: true });
    expect(withSamples.pass).toBe(false);
    expect(withSamples.failures[0]).toMatch(/Voice-match score 40/);

    const lenient = { ...DEFAULT_DESLOP_CONFIG, minVoiceMatch: 30 };
    expect(evaluateDeslop({ metrics, spoken: false, hasVoiceSamples: true, config: lenient }).pass).toBe(true);
  });
});
