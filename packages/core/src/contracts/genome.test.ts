import { describe, expect, it } from 'vitest';
import { parseGenomeDecomposition } from './genome.js';

const component = (type: string) => ({
  type,
  content: { summary: 'opens with a confession', evidence: 'I nearly lost the house…', pattern: 'damaging admission' },
  confidence: 0.9,
  tags: ['fitness', 'meta'],
});

describe('genome decomposition parse (WO-017)', () => {
  it('keeps typed components and reports the typed ratio', () => {
    const parsed = parseGenomeDecomposition({
      niche: 'fitness',
      channel: 'meta',
      awareness: 'problem',
      components: [
        component('lead'),
        component('proof_stack'),
        component('close'),
        component('not_a_type'), // dropped
      ],
    });
    expect(parsed.components.length).toBe(3);
    expect(parsed.dropped).toBe(1);
    expect(parsed.typedRatio).toBe(0.75);
    expect(parsed.niche).toBe('fitness');
  });

  it('accepts all seven canonical types', () => {
    const types = ['lead', 'mechanism_name', 'proof_stack', 'price_reveal', 'close', 'bullet_style', 'headline_pattern'];
    const parsed = parseGenomeDecomposition({ components: types.map(component) });
    expect(parsed.components.map((c) => c.type)).toEqual(types);
    expect(parsed.typedRatio).toBe(1);
  });

  it('throws when nothing valid survives', () => {
    expect(() =>
      parseGenomeDecomposition({ components: [component('nope'), { garbage: true }] }),
    ).toThrow(/no valid typed/);
    expect(() => parseGenomeDecomposition({ components: [] })).toThrow();
  });

  it('rejects malformed content (empty summary/evidence, bad confidence)', () => {
    const bad = { ...component('lead'), confidence: 1.5 };
    const parsed = parseGenomeDecomposition({ components: [component('lead'), bad] });
    expect(parsed.dropped).toBe(1);
    const noEvidence = { ...component('close'), content: { summary: 'x', evidence: '', pattern: '' } };
    expect(parseGenomeDecomposition({ components: [component('lead'), noEvidence] }).dropped).toBe(1);
  });
});
