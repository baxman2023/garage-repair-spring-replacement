import { describe, expect, it } from 'vitest';
import type { AssetBlock } from './blocks.js';
import { parseMarketProfile } from './contracts/marketProfile.js';
import { composePageBuildPackage } from './packageCompose.js';
import { compileUniversalPrompt } from './universalCompile.js';

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

const TEMPLATE = `ROLE: senior engineer.
STACK ({{stack_name}}):
{{stack_constraints}}
COPY:
{{copy_sections}}
PAYLOAD:
{{package_payload}}
CRITERIA:
{{acceptance_criteria}}
QA:
{{self_qa}}
OUTPUT: complete code, zero placeholders.`;

const ID = '0'.repeat(26);
const BLOCKS: AssetBlock[] = [
  { id: 'hl', role: 'headline', text: 'The Six A.M. Snap — with "quotes" and\nnewlines' },
  { id: 'lead', role: 'lead', text: 'It always happens on the worst morning.' },
  { id: 'cta', role: 'cta', text: 'Book the fix today.' },
];
const pkg = composePageBuildPackage({
  scope: { project: ID, market: ID, asset: ID, assetType: 'sales_letter' },
  blocks: BLOCKS,
  profile,
  title: 'SpringGuard',
});

describe('universal LLM prompt compiler (WO-038)', () => {
  it('carries every block verbatim in plain-text fences (even with quotes/newlines)', () => {
    const prompt = compileUniversalPrompt(pkg, TEMPLATE, 'single-html');
    for (const b of BLOCKS) expect(prompt).toContain(b.text);
    expect(prompt).toContain('DO-NOT-REWRITE');
    expect(prompt).toContain('### Block hl (headline)');
  });

  it('stack variants swap the tech constraints (--stack flag)', () => {
    const single = compileUniversalPrompt(pkg, TEMPLATE, 'single-html');
    expect(single).toContain('STACK (single-html)');
    expect(single).toContain('render correctly from file://');
    expect(single).not.toContain('App Router');

    const nextjs = compileUniversalPrompt(pkg, TEMPLATE, 'nextjs');
    expect(nextjs).toContain('STACK (nextjs)');
    expect(nextjs).toContain('App Router');
    expect(nextjs).toContain('`next build`');

    expect(() => compileUniversalPrompt(pkg, TEMPLATE, 'vue' as never)).toThrow(/Unknown stack/);
  });

  it('embeds the payload (design brief, choreography) and numbered criteria/QA', () => {
    const prompt = compileUniversalPrompt(pkg, TEMPLATE, 'single-html');
    expect(prompt).toContain('"cta_choreography"');
    expect(prompt).toContain('"visual_hierarchy"');
    expect(prompt).not.toContain('"copy_blocks"'); // copy travels in fences, not JSON
    expect(prompt).toMatch(/CRITERIA:\n1\. Every one of the 3 copy blocks/);
    expect(prompt).toMatch(/QA:\n1\. Diff every copy block/);
  });
});
