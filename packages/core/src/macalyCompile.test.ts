import { describe, expect, it } from 'vitest';
import type { AssetBlock } from './blocks.js';
import { parseMarketProfile } from './contracts/marketProfile.js';
import { composePageBuildPackage } from './packageCompose.js';
import {
  assertBlocksVerbatim,
  compileMacalyPrompt,
  joinPromptParts,
} from './macalyCompile.js';

const profile = parseMarketProfile({
  schema_version: '1',
  rank: 1,
  label: 'Homeowners',
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
  starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
  awareness_stage: 'problem',
  awareness_justification: 'x',
  sophistication: 2,
  sophistication_justification: 'x',
  resident_emotion: 'dread',
  core_desire: 'forget the door',
  objections: ['a', 'b', 'c', 'd', 'e'],
  voc_corpus_ref: '',
  channels_ranked: ['search'],
  entry_conversation: 'snap?',
});

const TEMPLATE = `BUILD A PAGE.
{{part_note}}
GOAL: {{page_goal}}
SECTIONS:
{{sections}}
CTA: {{cta_wiring}}
SCHEMA: {{schema_embed}}
QUIZ: {{quiz_embed}}
CHECK:
{{self_check}}`;

const ID = '0'.repeat(26);
const blocks = (n: number, wordsPer = 40): AssetBlock[] => [
  { id: 'hl', role: 'headline', text: 'The Six A.M. Snap' },
  ...Array.from({ length: n }, (_v, i) => ({
    id: `body-${i + 1}`,
    role: 'body',
    text: Array.from({ length: wordsPer }, (_w, j) => `section${i + 1}word${j}`).join(' '),
  })),
  { id: 'cta', role: 'cta', text: 'Book the fix today.' },
];

const pkgOf = (bs: AssetBlock[]) =>
  composePageBuildPackage({
    scope: { project: ID, market: ID, asset: ID, assetType: 'sales_letter' },
    blocks: bs,
    profile,
    title: 'SpringGuard',
  });

describe('Macaly prompt compiler (WO-037)', () => {
  it('single prompt carries 100% of copy blocks verbatim with DO-NOT-REWRITE fences (acceptance)', () => {
    const bs = blocks(3);
    const result = compileMacalyPrompt(pkgOf(bs), TEMPLATE);
    expect(result.split).toBe(false);
    expect(result.prompts).toHaveLength(1);
    const prompt = result.prompts[0]!;
    for (const b of bs) expect(prompt).toContain(b.text); // verbatim, asserted independently
    expect(prompt).toContain('DO-NOT-REWRITE');
    expect(prompt).toContain('GOAL: A sales letter page');
    expect(prompt).toContain('The ONLY CTA action, verbatim label: "Book the fix today."');
    expect(prompt).toContain('CHECK:');
    expect(prompt).toContain('copy blocks appears on the page VERBATIM');
  });

  it('overflow splits into build + refine prompts within the budget; union stays verbatim (acceptance)', () => {
    const bs = blocks(20, 120); // big
    const budget = 6_000;
    const result = compileMacalyPrompt(pkgOf(bs), TEMPLATE, budget);
    expect(result.split).toBe(true);
    expect(result.prompts.length).toBeGreaterThan(1);
    for (const p of result.prompts) expect(p.length).toBeLessThanOrEqual(budget * 1.15);
    expect(result.prompts[0]).toContain('PART 1 of');
    expect(result.prompts[0]).toContain('BUILD the full page structure');
    expect(result.prompts[1]).toContain('REFINE the page you just built');
    // Union carries every block verbatim.
    const union = result.prompts.join('\n');
    for (const b of bs) expect(union).toContain(b.text);
  });

  it('assertBlocksVerbatim fails closed on a dropped block', () => {
    const bs = blocks(2);
    expect(() => assertBlocksVerbatim(['prompt without the copy'], bs)).toThrow(/not carried verbatim/);
  });

  it('joinPromptParts is transparent for one part and marked for many', () => {
    expect(joinPromptParts(['only'])).toBe('only');
    const joined = joinPromptParts(['a', 'b']);
    expect(joined).toContain('===== MACALY PROMPT 1 of 2 =====');
    expect(joined).toContain('===== MACALY PROMPT 2 of 2 =====');
  });
});
