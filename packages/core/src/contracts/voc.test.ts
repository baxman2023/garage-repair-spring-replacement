import { describe, expect, it } from 'vitest';
import {
  dedupePhrases,
  normalizePhrase,
  parseVocExtractionResult,
  vocCorpusPromptBlock,
  vocQuoteRate,
} from './voc.js';

describe('VOC contract + dedupe (WO-014)', () => {
  it('parses typed phrases and rejects bad kinds', () => {
    const ok = parseVocExtractionResult({
      phrases: [{ phrase: 'the door screeches every morning', kind: 'pain' }],
    });
    expect(ok.phrases[0]!.kind).toBe('pain');
    expect(() =>
      parseVocExtractionResult({ phrases: [{ phrase: 'x y z', kind: 'complaint' }] }),
    ).toThrow();
    expect(() => parseVocExtractionResult({ phrases: [] })).toThrow();
  });

  it('normalizes for dedupe (case, punctuation, whitespace)', () => {
    expect(normalizePhrase("It's  GOING to snap!!")).toBe('its going to snap');
    expect(normalizePhrase('it’s going to snap')).toBe('its going to snap');
  });

  it('dedupes within batch and against an existing corpus', () => {
    const fresh = dedupePhrases(
      [
        { phrase: 'The spring SNAPPED at 6am', kind: 'pain' },
        { phrase: 'the spring snapped at 6am!', kind: 'pain' }, // batch dupe
        { phrase: 'I just want it to work', kind: 'desire' },
        { phrase: 'these guys always upsell', kind: 'objection' }, // exists already
      ],
      ['These guys ALWAYS upsell…'],
    );
    expect(fresh.map((p) => p.phrase)).toEqual([
      'The spring SNAPPED at 6am',
      'I just want it to work',
    ]);
  });
});

describe('VOC cache block + spot-check harness', () => {
  const corpus = [
    { phrase: 'the spring snapped at 6am', kind: 'pain' as const },
    { phrase: 'I just want it to work', kind: 'desire' as const },
    { phrase: 'these guys always upsell', kind: 'objection' as const },
  ];

  it('renders the corpus grouped by kind for prompt injection', () => {
    const block = vocCorpusPromptBlock(corpus);
    expect(block).toContain('VOICE OF CUSTOMER CORPUS');
    expect(block).toContain('PAIN — in their own words:');
    expect(block).toContain('- "the spring snapped at 6am"');
    expect(block).toContain('OBJECTION — in their own words:');
    expect(block.indexOf('PAIN')).toBeLessThan(block.indexOf('DESIRE'));
  });

  it('spot-check harness detects quoted VOC in generated copy', () => {
    const generated =
      'You remember the morning the spring snapped at 6AM. "I just want it to work," you told yourself.';
    const report = vocQuoteRate(generated, corpus.map((c) => c.phrase));
    expect(report.quoted).toEqual(['the spring snapped at 6am', 'I just want it to work']);
    expect(report.rate).toBeCloseTo(2 / 3, 5);
    expect(vocQuoteRate('generic marketing copy', corpus.map((c) => c.phrase)).rate).toBe(0);
  });
});
