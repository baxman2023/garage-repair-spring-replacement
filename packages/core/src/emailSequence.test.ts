import { describe, expect, it } from 'vitest';
import { AI_TELLS, findAiTells, hasEmDashOveruse } from './aiTells.js';
import {
  extractMergeFields,
  findUnknownMergeFields,
  sequenceGraph,
  validateEmailSequence,
  type SequenceEmail,
} from './contracts/emailSequence.js';

describe('AI-tell scrub (G5 config list)', () => {
  it('flags the canonical tells case-insensitively', () => {
    expect(findAiTells('Let us Delve into savings')).toContain('delve');
    expect(findAiTells('Navigate the complexities of garage doors')).toContain('navigate the complexities');
    expect(findAiTells("In today's world, doors fail")).toContain("in today's world");
    expect(findAiTells('This is a game-changer for you')).toContain('game-changer');
  });

  it('matches wildcard tells across a few words', () => {
    expect(findAiTells('Take your garage door game to the next level')).toContain('take your * to the next level');
  });

  it('does not flag clean copy or partial words', () => {
    expect(findAiTells('The spring snapped at six in the morning.')).toEqual([]);
    expect(findAiTells('The unlocked door swung open.')).toEqual([]); // 'unlock the' ≠ 'unlocked'
  });

  it('em-dash overuse is a density rule with a small allowance', () => {
    expect(hasEmDashOveruse('one — two')).toBe(false);
    expect(hasEmDashOveruse('a — b — c words words words')).toBe(false); // ≤2 allowed
    expect(hasEmDashOveruse('a — b — c — d')).toBe(true);
  });

  it('the list itself is config: non-empty, lowercase', () => {
    expect(AI_TELLS.length).toBeGreaterThan(10);
    for (const tell of AI_TELLS) expect(tell).toBe(tell.toLowerCase());
  });
});

describe('merge-field conventions', () => {
  it('extracts tokens and tolerates inner whitespace', () => {
    expect(extractMergeFields('Hey {{first_name}}, click {{ cta_link }}')).toEqual(['first_name', 'cta_link']);
  });

  it('flags undocumented tokens', () => {
    expect(findUnknownMergeFields('Use {{coupon_code}} and {{cta_link}}')).toEqual(['coupon_code']);
  });
});

const email = (over: Partial<SequenceEmail> = {}): SequenceEmail => ({
  id: 'e1',
  subject: 'The spring truth nobody mentions',
  preview: 'What the installer never says out loud.',
  body: 'It snapped at six in the morning.\n\nSee the fix here: {{cta_link}}\n\n{{founder_name}}',
  send_offset_hours: 0,
  ...over,
});

const seq = (n: number, start = 0): SequenceEmail[] =>
  Array.from({ length: n }, (_v, i) => email({ id: `e${i + 1}`, send_offset_hours: start + i * 24 }));

describe('validateEmailSequence (WO-026)', () => {
  it('accepts a valid welcome sequence of 5-7 and rejects 4 or 8', () => {
    expect(() => validateEmailSequence('welcome', seq(5))).not.toThrow();
    expect(() => validateEmailSequence('welcome', seq(7))).not.toThrow();
    expect(() => validateEmailSequence('welcome', seq(4))).toThrow(/5-7/);
    expect(() => validateEmailSequence('welcome', seq(8))).toThrow(/5-7/);
  });

  it('launch: exactly 9, phases tagged, ordered seed→open→close, all present', () => {
    const phases = ['seed', 'seed', 'seed', 'open', 'open', 'open', 'close', 'close', 'close'] as const;
    const launch = seq(9).map((e, i) => ({ ...e, phase: phases[i] }));
    expect(() => validateEmailSequence('launch', launch)).not.toThrow();

    expect(() => validateEmailSequence('launch', seq(9))).toThrow(/missing its seed\/open\/close/);
    const backwards = launch.map((e, i) => ({ ...e, phase: phases[8 - i] }));
    expect(() => validateEmailSequence('launch', backwards)).toThrow(/moves backwards/);
    const noClose = launch.map((e) => ({ ...e, phase: e.phase === 'close' ? ('open' as const) : e.phase }));
    expect(() => validateEmailSequence('launch', noClose)).toThrow(/missing phase\(s\): close/);
  });

  it('cart abandon is exactly 3; daily infotainment exactly 10', () => {
    expect(() => validateEmailSequence('cart_abandon', seq(3, 1))).not.toThrow();
    expect(() => validateEmailSequence('cart_abandon', seq(2, 1))).toThrow(/exactly 3/);
    expect(() => validateEmailSequence('daily_infotainment', seq(10, 24))).not.toThrow();
    expect(() => validateEmailSequence('daily_infotainment', seq(9, 24))).toThrow(/exactly 10/);
  });

  it('send offsets must strictly increase', () => {
    const flat = seq(3, 1).map((e) => ({ ...e, send_offset_hours: 5 }));
    expect(() => validateEmailSequence('cart_abandon', flat)).toThrow(/strictly increase/);
  });

  it('subjects are AI-tell scrubbed and restricted to {{first_name}}', () => {
    const telly = seq(3, 1);
    telly[1] = email({ id: 'e2', send_offset_hours: 24, subject: 'Unlock the secret to quiet doors' });
    expect(() => validateEmailSequence('cart_abandon', telly)).toThrow(/AI-tell/);

    const tokened = seq(3, 1);
    tokened[0] = email({ id: 'e1', send_offset_hours: 1, subject: 'Your {{product_name}} is waiting' });
    expect(() => validateEmailSequence('cart_abandon', tokened)).toThrow(/only use \{\{first_name\}\}/);
    const personalized = seq(3, 1);
    personalized[0] = email({ id: 'e1', send_offset_hours: 1, subject: '{{first_name}}, still there?' });
    expect(() => validateEmailSequence('cart_abandon', personalized)).not.toThrow();
  });

  it('single-CTA rule: exactly one {{cta_link}} per body', () => {
    const none = seq(3, 1);
    none[0] = email({ id: 'e1', send_offset_hours: 1, body: 'No link here at all.' });
    expect(() => validateEmailSequence('cart_abandon', none)).toThrow(/exactly one \{\{cta_link\}\}; found 0/);
    const two = seq(3, 1);
    two[0] = email({ id: 'e1', send_offset_hours: 1, body: 'Click {{cta_link}} or {{cta_link}}' });
    expect(() => validateEmailSequence('cart_abandon', two)).toThrow(/found 2/);
  });

  it('unknown merge fields fail closed', () => {
    const bad = seq(3, 1);
    bad[2] = email({ id: 'e3', send_offset_hours: 72, body: 'Use {{coupon_code}} now: {{cta_link}}' });
    expect(() => validateEmailSequence('cart_abandon', bad)).toThrow(/undocumented merge fields: coupon_code/);
  });

  it('sequenceGraph carries the send-offset schedule (and phases when present)', () => {
    const launch = seq(9).map((e, i) => ({ ...e, phase: (['seed', 'open', 'close'] as const)[Math.floor(i / 3)] }));
    const graph = sequenceGraph('launch', launch);
    expect(graph.kind).toBe('launch');
    expect(graph.emails).toHaveLength(9);
    expect(graph.emails[0]).toEqual({ id: 'e1', send_offset_hours: 0, phase: 'seed' });
    expect(graph.emails.map((e) => e.send_offset_hours)).toEqual(launch.map((e) => e.send_offset_hours));
  });
});
