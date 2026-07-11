import { describe, expect, it } from 'vitest';
import { checkG0, parseOffer, parseOfferForgeResult } from './offer.js';

const GOOD_OFFER = {
  schema_version: '1',
  name: 'The SpringGuard Total Protection Package',
  diagnosis: 'risk-reversal-led variant',
  value_stack: [
    { item: 'High-cycle spring pair', value_usd: 400, justification: 'hardware cost' },
    { item: '5-year workmanship warranty', value_usd: 250, justification: 'priced from service plans' },
  ],
  risk_reversal: 'Full refund within 90 days if a spring fails, plus we pay the competitor to fix it.',
  urgency_mechanisms: [
    {
      type: 'capacity_limit',
      description: 'Only 12 install slots per week with our two crews.',
      legitimacy_basis: 'Two crews, six installs per crew per week — real scheduling capacity.',
    },
  ],
  price_framing: 'Less than one emergency call-out, amortized to 19 cents a day over the warranty.',
  price: { amount: 349, model: 'one-time' },
  offer_name_candidates: ['SpringGuard Shield', 'Never-Stranded Package'],
};

describe('offer contract', () => {
  it('accepts a complete legitimate offer', () => {
    const offer = parseOffer(GOOD_OFFER);
    expect(offer.urgency_mechanisms[0]!.type).toBe('capacity_limit');
  });

  it('structurally rejects illegitimate urgency types', () => {
    expect(() =>
      parseOffer({
        ...GOOD_OFFER,
        urgency_mechanisms: [
          { type: 'fake_countdown', description: 'timer', legitimacy_basis: 'none' },
        ],
      }),
    ).toThrow();
  });

  it('structurally rejects fabricated-scarcity language', () => {
    for (const description of [
      'A fake deadline to drive clicks',
      'Evergreen countdown that resets for each visitor',
      'Artificial stock limit',
    ]) {
      expect(() =>
        parseOffer({
          ...GOOD_OFFER,
          urgency_mechanisms: [{ type: 'deadline', description, legitimacy_basis: 'marketing' }],
        }),
      ).toThrow();
    }
  });

  it('requires exactly three variants from the forge', () => {
    expect(() =>
      parseOfferForgeResult({ diagnosis: 'weak offer', variants: [GOOD_OFFER, GOOD_OFFER] }),
    ).toThrow();
    const ok = parseOfferForgeResult({
      diagnosis: 'weak offer',
      variants: [GOOD_OFFER, GOOD_OFFER, GOOD_OFFER],
    });
    expect(ok.variants.length).toBe(3);
  });
});

describe('G0 checklist', () => {
  it('passes a complete offer', () => {
    const report = checkG0(parseOffer(GOOD_OFFER));
    expect(report.pass).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('fails each missing checklist item with a reason', () => {
    const base = parseOffer(GOOD_OFFER);
    const cases: Array<[Partial<typeof base>, string]> = [
      [{ value_stack: [] }, 'Value stack'],
      [{ risk_reversal: '' }, 'risk reversal'],
      [{ urgency_mechanisms: [] }, 'urgency'],
      [{ price_framing: ' ' }, 'Price framing'],
      [{ name: '' }, 'name'],
    ];
    for (const [patch, needle] of cases) {
      const report = checkG0({ ...base, ...patch });
      expect(report.pass).toBe(false);
      expect(report.failures.join(' ')).toMatch(new RegExp(needle, 'i'));
    }
  });

  it('fails an unquantified value stack', () => {
    const base = parseOffer(GOOD_OFFER);
    const report = checkG0({
      ...base,
      value_stack: [{ item: 'Mystery bonus', value_usd: 0 as never, justification: '' }],
    });
    expect(report.pass).toBe(false);
    expect(report.checklist.quantified_value_stack).toBe(false);
  });
});
