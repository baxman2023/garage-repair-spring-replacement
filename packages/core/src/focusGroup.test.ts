import { describe, expect, it } from 'vitest';
import type { AssetBlock } from './blocks.js';
import { parseMarketProfile } from './contracts/marketProfile.js';
import {
  aggregateFocusGroup,
  composeFocusFixBrief,
  DEFAULT_FOCUS_GROUP_CONFIG,
  renderFocusReportMarkdown,
  samplePersonas,
  type PersonaResult,
} from './focusGroup.js';

const profile = parseMarketProfile({
  schema_version: '1',
  rank: 1,
  label: 'Homeowners',
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'door screeches' },
  starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
  awareness_stage: 'problem',
  awareness_justification: 'daily symptom',
  sophistication: 2,
  sophistication_justification: 'low',
  resident_emotion: 'dread',
  core_desire: 'forget the door',
  objections: ['too expensive', 'DIY is fine', 'scam?', 'my door is fine', 'no time'],
  voc_corpus_ref: '',
  channels_ranked: ['search'],
  entry_conversation: 'Is this going to snap?',
});

const BLOCKS: AssetBlock[] = [
  { id: 'hook', role: 'hook', text: 'The bang at six a.m.' },
  { id: 'proof', role: 'proof', text: 'It is rated ten thousand cycles by the independent lab.' },
  { id: 'cta', role: 'cta', text: 'Book the fix today.' },
];
const CLAIMS = ['rated ten thousand cycles', 'installed in under one hour'];

const result = (i: number, over: Partial<PersonaResult> = {}): PersonaResult => ({
  persona_id: `persona-${i + 1}`,
  reached_cta: true,
  attention_drop_block: null,
  disbelief_claims: [],
  bounce_reason: '',
  spouse_test_quote: 'Sounds practical.',
  ...over,
});

describe('samplePersonas (WO-029)', () => {
  it('returns a deterministic cohort varying skepticism and awareness within band', () => {
    const cohort = samplePersonas(profile, 20);
    expect(cohort).toHaveLength(20);
    expect(new Set(cohort.map((p) => p.skepticism))).toEqual(new Set([1, 2, 3, 4, 5]));
    // Band around 'problem': the stage and its neighbors only.
    expect(new Set(cohort.map((p) => p.awareness))).toEqual(new Set(['problem', 'unaware', 'solution']));
    expect(new Set(cohort.map((p) => p.primaryObjection))).toEqual(new Set(profile.objections));
    expect(samplePersonas(profile, 20)).toEqual(cohort); // no RNG
  });
});

describe('aggregateFocusGroup — §5 G4 thresholds', () => {
  it('passes at ≥70% CTA reach with no disbelief spike ≥50%', () => {
    const results = Array.from({ length: 20 }, (_v, i) =>
      result(i, {
        reached_cta: i < 15, // 75%
        disbelief_claims: i < 6 ? ['rated ten thousand cycles'] : [], // 30%
        attention_drop_block: i >= 15 ? 'proof' : null,
        bounce_reason: i >= 15 ? 'numbers felt inflated' : '',
      }),
    );
    const report = aggregateFocusGroup({ results, blocks: BLOCKS, claims: CLAIMS });
    expect(report.pass).toBe(true);
    expect(report.ctaReachRatio).toBeCloseTo(0.75, 5);
    expect(report.spikes[0]).toMatchObject({ claim: 'rated ten thousand cycles', count: 6 });
    // Annotations anchored: attention drops on 'proof', disbelief mapped to its carrier block.
    expect(report.annotations.find((a) => a.kind === 'attention_drop')!.blockId).toBe('proof');
    expect(report.annotations.find((a) => a.kind === 'disbelief')!.blockId).toBe('proof');
  });

  it('fails below the CTA-reach threshold and on a disbelief spike ≥50%', () => {
    const lowReach = Array.from({ length: 20 }, (_v, i) => result(i, { reached_cta: i < 10 }));
    const r1 = aggregateFocusGroup({ results: lowReach, blocks: BLOCKS, claims: CLAIMS });
    expect(r1.pass).toBe(false);
    expect(r1.failures[0]).toMatch(/50% of the cohort reached the CTA/);

    const spiky = Array.from({ length: 20 }, (_v, i) =>
      result(i, { disbelief_claims: i < 11 ? ['Rated ten thousand cycles!'] : [] }),
    );
    const r2 = aggregateFocusGroup({ results: spiky, blocks: BLOCKS, claims: CLAIMS });
    expect(r2.pass).toBe(false);
    expect(r2.failures[0]).toMatch(/spiked disbelief in 55%/);
  });

  it('thresholds are config-driven', () => {
    const results = Array.from({ length: 20 }, (_v, i) => result(i, { reached_cta: i < 15 }));
    const strict = { ...DEFAULT_FOCUS_GROUP_CONFIG, minCtaReachRatio: 0.9 };
    expect(aggregateFocusGroup({ results, blocks: BLOCKS, claims: CLAIMS }).pass).toBe(true);
    expect(aggregateFocusGroup({ results, blocks: BLOCKS, claims: CLAIMS, config: strict }).pass).toBe(false);
  });

  it('rejects annotations anchored to unknown block ids', () => {
    const results = [result(0, { attention_drop_block: 'ghost-block' })];
    expect(() => aggregateFocusGroup({ results, blocks: BLOCKS, claims: CLAIMS })).toThrow(
      /unknown block "ghost-block"/,
    );
  });

  it('counts one disbelief vote per persona per claim', () => {
    const results = [
      result(0, { disbelief_claims: ['rated ten thousand cycles', 'RATED TEN THOUSAND CYCLES'] }),
      result(1),
    ];
    const report = aggregateFocusGroup({ results, blocks: BLOCKS, claims: CLAIMS });
    expect(report.spikes[0]!.count).toBe(1);
  });
});

describe('fix brief + markdown export', () => {
  it('brief carries failures and anchored annotations; markdown renders the report', () => {
    const results = Array.from({ length: 20 }, (_v, i) =>
      result(i, {
        reached_cta: i < 10,
        attention_drop_block: i >= 10 ? 'hook' : null,
        bounce_reason: i >= 10 ? 'felt like every other ad' : '',
      }),
    );
    const report = aggregateFocusGroup({ results, blocks: BLOCKS, claims: CLAIMS });
    const brief = composeFocusFixBrief(report, BLOCKS);
    expect(brief).toContain('GATE FAILURE');
    expect(brief).toContain('[block hook · hook] ATTENTION DROP');
    expect(brief).toContain('felt like every other ad');

    const md = renderFocusReportMarkdown(report);
    expect(md).toContain('# Synthetic Focus Group — G4 FAIL');
    expect(md).toContain('`hook` [attention_drop]');
    expect(md).toContain('Reached CTA: 50%');
  });
});
