import { describe, expect, it } from 'vitest';
import type { AssetBlock } from './blocks.js';
import {
  complianceFindingKey,
  evaluateCompliance,
  hasRequiredDisclaimer,
  insertRequiredDisclaimer,
  packsForMode,
  runCompliancePacks,
} from './compliance.js';

const block = (id: string, text: string): AssetBlock => ({ id, role: 'body', text });

const run = (text: string, mode: 'none' | 'health' | 'finance' = 'none') =>
  runCompliancePacks([block('b1', text)], mode);

describe('rule packs — fixture violations (WO-032 acceptance)', () => {
  it('FTC: earnings claim without a typicality disclaimer', () => {
    const hits = run('Members make $5,000 per month with this system.');
    expect(hits.map((f) => f.ruleId)).toContain('ftc.earnings_claim_disclaimer');
    expect(run('Members make $5,000 per month. Results are not typical.')).toEqual([]);
  });

  it('FTC: testimonial without disclosure; guaranteed outcomes are errors', () => {
    const testimonial = run('“This fixed my door in a single afternoon and saved my weekend” — Sandra');
    expect(testimonial[0]!.ruleId).toBe('ftc.testimonial_disclosure');
    expect(testimonial[0]!.severity).toBe('warning');

    const guaranteed = run('Guaranteed results in thirty days or less.');
    expect(guaranteed[0]!.ruleId).toBe('ftc.guaranteed_outcome');
    expect(guaranteed[0]!.severity).toBe('error');
  });

  it('health mode: disease claims are errors; diagnosis language warns', () => {
    const cure = run('This supplement cures diabetes in weeks.', 'health');
    expect(cure.map((f) => f.ruleId)).toContain('health.disease_claim');
    expect(cure.find((f) => f.ruleId === 'health.disease_claim')!.severity).toBe('error');

    const diagnosis = run('If you suffer from arthritis, listen closely.', 'health');
    expect(diagnosis.map((f) => f.ruleId)).toContain('health.diagnosis_language');
  });

  it('health rules do NOT run outside health mode', () => {
    expect(run('This supplement cures diabetes in weeks.', 'none').map((f) => f.pack)).not.toContain('health');
    expect(packsForMode('none')).toEqual(['ftc', 'ad_policy']);
    expect(packsForMode('finance')).toContain('finance');
  });

  it('finance mode: earnings claims REQUIRE a disclaimer; risk-free is an error', () => {
    const noDisclaimer = run('Students earn $2,000 per week trading this setup.', 'finance');
    expect(noDisclaimer.map((f) => f.ruleId)).toContain('finance.earnings_disclaimer_required');
    expect(
      run('Students earn $2,000 per week. Results may vary and past performance is no guarantee.', 'finance').map(
        (f) => f.ruleId,
      ),
    ).not.toContain('finance.earnings_disclaimer_required');

    const riskFree = run('Enjoy risk-free returns every quarter.', 'finance');
    expect(riskFree.find((f) => f.ruleId === 'finance.risk_free')!.severity).toBe('error');
  });

  it('ad-policy lint: personal attributes, before/after, sensational', () => {
    expect(run('Struggling with your debt? We can help.')[0]!.ruleId).toBe('ad_policy.personal_attributes');
    expect(run('See the before and after photos below.')[0]!.ruleId).toBe('ad_policy.before_after');
    expect(run('The shocking truth doctors hate.').map((f) => f.ruleId)).toContain('ad_policy.sensational');
  });

  it('findings anchor to the carrying block with an excerpt (line refs)', () => {
    const findings = runCompliancePacks(
      [block('clean', 'A quiet, honest sentence.'), block('dirty', 'One weird trick fixes doors.')],
      'none',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.blockId).toBe('dirty');
    expect(findings[0]!.excerpt.toLowerCase()).toContain('one weird trick');
  });
});

describe('required-disclaimer inserter', () => {
  it('appends the mode disclaimer once, as a locked block', () => {
    const blocks = [block('lead', 'Students earn $2,000 per week.')];
    expect(hasRequiredDisclaimer(blocks, 'finance')).toBe(false);
    const first = insertRequiredDisclaimer(blocks, 'finance');
    expect(first.inserted).toBe(true);
    const disclaimer = first.blocks[first.blocks.length - 1]!;
    expect(disclaimer.text).toContain('Results may vary');
    expect(disclaimer.meta).toMatchObject({ section: 'disclaimer', locked: true });
    // Idempotent.
    const second = insertRequiredDisclaimer(first.blocks, 'finance');
    expect(second.inserted).toBe(false);
    expect(insertRequiredDisclaimer(blocks, 'none').inserted).toBe(false);
  });
});

describe('evaluateCompliance — acknowledgment semantics', () => {
  const warning = runCompliancePacks([block('b1', 'See the before and after photos.')], 'none')[0]!;
  const error = runCompliancePacks([block('b2', 'Guaranteed income for everyone.')], 'none')[0]!;

  it('unacknowledged warnings fail; acknowledged warnings pass', () => {
    expect(evaluateCompliance([warning], new Set()).pass).toBe(false);
    const verdict = evaluateCompliance([warning], new Set([complianceFindingKey(warning)]));
    expect(verdict.pass).toBe(true);
    expect(verdict.acknowledgedWarnings).toHaveLength(1);
  });

  it('errors can NEVER be acknowledged away', () => {
    const verdict = evaluateCompliance([error], new Set([complianceFindingKey(error)]));
    expect(verdict.pass).toBe(false);
    expect(verdict.errors).toHaveLength(1);
  });
});
