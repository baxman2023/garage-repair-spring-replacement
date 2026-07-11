import { describe, expect, it } from 'vitest';
import {
  applyIntakeAnswer,
  emptyProductProfile,
  INTAKE_QUESTIONS,
  mergeProductProfiles,
  parseProductProfile,
  unansweredProfileFields,
} from './productProfile.js';

describe('product profile contract', () => {
  it('produces a contract-valid empty draft', () => {
    const p = emptyProductProfile();
    expect(p.schema_version).toBe('1');
    expect(p.constraints.compliance_mode).toBe('none');
    expect(parseProductProfile(p)).toEqual(p);
  });

  it('rejects structurally invalid data', () => {
    expect(() => parseProductProfile({ price: { amount: 'a lot' } })).toThrow();
    expect(() => parseProductProfile({ constraints: { compliance_mode: 'crypto' } })).toThrow();
  });

  it('merge: non-empty incoming wins, empty never clobbers, arrays union', () => {
    const base = parseProductProfile({
      name: 'Original',
      guarantees: ['30-day refund'],
      mechanism: { problem_mechanism: 'root cause', solution_mechanism: '', name: '' },
      price: { amount: 100, model: 'one-time' },
    });
    const merged = mergeProductProfiles(base, {
      name: '',
      promise: 'Double output',
      guarantees: ['30-day refund', 'keep the bonuses'],
      mechanism: { problem_mechanism: '', solution_mechanism: 'new pathway', name: '' },
      price: { amount: 0, model: '' },
    } as never);
    expect(merged.name).toBe('Original'); // empty incoming did not clobber
    expect(merged.promise).toBe('Double output');
    expect(merged.guarantees).toEqual(['30-day refund', 'keep the bonuses']);
    expect(merged.mechanism.problem_mechanism).toBe('root cause');
    expect(merged.mechanism.solution_mechanism).toBe('new pathway');
    expect(merged.price.amount).toBe(100);
  });
});

describe('interrogation flow', () => {
  it('asks everything for an empty profile', () => {
    const qs = unansweredProfileFields(emptyProductProfile());
    expect(qs.length).toBe(INTAKE_QUESTIONS.length);
  });

  it('asks only unanswered fields', () => {
    let p = emptyProductProfile();
    p = applyIntakeAnswer(p, 'name', 'CopyForge');
    p = applyIntakeAnswer(p, 'price.amount', '$1,000');
    const remaining = unansweredProfileFields(p);
    const fields = remaining.map((q) => q.field);
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('price.amount');
    expect(fields).toContain('origin_story');
    expect(p.name).toBe('CopyForge');
    expect(p.price.amount).toBe(1000);
  });

  it('compliance_mode stays queued until explicitly answered, then drops', () => {
    const p = emptyProductProfile();
    const before = unansweredProfileFields(p).map((q) => q.field);
    expect(before).toContain('constraints.compliance_mode');

    const answered = applyIntakeAnswer(p, 'constraints.compliance_mode', 'none');
    expect(answered.constraints.compliance_mode).toBe('none');
    const after = unansweredProfileFields(answered, new Set(['constraints.compliance_mode']));
    expect(after.map((q) => q.field)).not.toContain('constraints.compliance_mode');
  });

  it('maps list answers, including proof assets', () => {
    let p = emptyProductProfile();
    p = applyIntakeAnswer(p, 'proof_assets', '87% success in pilot\nDr. Reyes endorsement');
    expect(p.proof_assets).toEqual([
      { type: 'stated', ref: '87% success in pilot', strength: '' },
      { type: 'stated', ref: 'Dr. Reyes endorsement', strength: '' },
    ]);
    p = applyIntakeAnswer(p, 'guarantees', 'Full refund\n');
    expect(p.guarantees).toEqual(['Full refund']);
  });

  it('rejects invalid choice and non-numeric answers', () => {
    const p = emptyProductProfile();
    expect(() => applyIntakeAnswer(p, 'constraints.compliance_mode', 'crypto')).toThrow();
    expect(() => applyIntakeAnswer(p, 'price.amount', 'call us')).toThrow();
    expect(() => applyIntakeAnswer(p, 'not.a.field', 'x')).toThrow();
  });
});
