import { describe, expect, it } from 'vitest';
import type { AssetBlock } from './blocks.js';
import { parseMarketProfile } from './contracts/marketProfile.js';
import { checkG7 } from './contracts/pageBuildPackage.js';
import {
  buildVideoObject,
  composePageBuildPackage,
  packageChecksum,
  type ComposeInputs,
} from './packageCompose.js';

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
  entry_conversation: 'Is this going to snap?',
});

const ID = '0'.repeat(26);
const VSL_BLOCKS: AssetBlock[] = [
  { id: 'hook', role: 'hook', text: 'The bang at six a.m.', meta: { timestampStart: 0, timestampEnd: 12.4 } },
  { id: 'mech', role: 'mechanism', text: 'Cycle fatigue is the real culprit.', meta: { timestampStart: 12.4, timestampEnd: 180 } },
  { id: 'offer', role: 'offer', text: 'The full kit, installed.', meta: { timestampStart: 180, timestampEnd: 700 } },
  { id: 'cta', role: 'cta', text: 'Book the fix today.', meta: { timestampStart: 700, timestampEnd: 754 } },
];
const LETTER_BLOCKS: AssetBlock[] = [
  { id: 'hl', role: 'headline', text: 'The Six A.M. Snap' },
  { id: 'lead', role: 'lead', text: 'It always happens on the worst morning.' },
  { id: 'proof', role: 'proof', text: 'Rated ten thousand cycles by the lab.' },
  { id: 'offer', role: 'offer', text: 'Everything included, one visit.' },
  { id: 'cta', role: 'cta', text: 'Book the fix today.' },
];

const vslInputs = (over: Partial<ComposeInputs> = {}): ComposeInputs => ({
  scope: { project: ID, market: ID, asset: ID, assetType: 'vsl' },
  blocks: VSL_BLOCKS,
  profile,
  title: 'SpringGuard',
  ...over,
});

describe('page build package composer (WO-035)', () => {
  it('composes a contract-valid package; checksum is stable across identical inputs (acceptance)', () => {
    const a = composePageBuildPackage(vslInputs());
    const b = composePageBuildPackage(vslInputs());
    expect(packageChecksum(a)).toBe(packageChecksum(b)); // deterministic

    const changed = composePageBuildPackage(
      vslInputs({ blocks: VSL_BLOCKS.map((x) => (x.id === 'hook' ? { ...x, text: 'A different hook.' } : x)) }),
    );
    expect(packageChecksum(changed)).not.toBe(packageChecksum(a));
  });

  it('renderings do not perturb the checksum (they are filled in later)', () => {
    const bare = composePageBuildPackage(vslInputs());
    const rendered = composePageBuildPackage(
      vslInputs({
        renderings: { file_paths: ['/tmp/x.md'], macaly_prompt: 'p', universal_llm_prompt: 'q' },
      }),
    );
    expect(packageChecksum(rendered)).toBe(packageChecksum(bare));
  });

  it('missing renderings block G7 (acceptance)', () => {
    const bare = composePageBuildPackage(vslInputs());
    const g7 = checkG7(bare);
    expect(g7.pass).toBe(false);
    expect(g7.missing).toEqual([
      'renderings.file_paths',
      'renderings.macaly_prompt',
      'renderings.universal_llm_prompt',
    ]);
    const complete = composePageBuildPackage(
      vslInputs({ renderings: { file_paths: ['a.md'], macaly_prompt: 'p', universal_llm_prompt: 'q' } }),
    );
    expect(checkG7(complete).pass).toBe(true);
  });

  it('VSL pages get VideoObject JSON-LD with the 170-WPM duration and t: choreography', () => {
    const pkg = composePageBuildPackage(vslInputs());
    expect(pkg.media.videoobject_schema).toMatchObject({
      '@type': 'VideoObject',
      name: 'SpringGuard',
      duration: 'PT12M34S', // 754s
    });
    expect(pkg.design_brief.cta_choreography.buy_reveal_at).toBe('t:180.0');
    expect(pkg.design_brief.cta_choreography.sticky_cta_at).toBe('t:165.0');
    expect(buildVideoObject(LETTER_BLOCKS, 'sales_letter', 'x')).toBeNull();
  });

  it('letters key choreography off blocks and map the persuasion sequence', () => {
    const pkg = composePageBuildPackage(
      vslInputs({ scope: { project: ID, market: ID, asset: ID, assetType: 'sales_letter' }, blocks: LETTER_BLOCKS }),
    );
    expect(pkg.design_brief.cta_choreography).toEqual({
      sticky_cta_at: 'block:proof',
      buy_reveal_at: 'block:offer',
    });
    expect(pkg.media.videoobject_schema).toBeNull();
    // Visual hierarchy follows block order with role weights.
    expect(pkg.design_brief.visual_hierarchy[0]).toMatchObject({ weight: 5 }); // headline
    expect(pkg.design_brief.section_map.map((s) => s.block_id)).toEqual(LETTER_BLOCKS.map((b) => b.id));
  });

  it('acceptance criteria and self-QA are content-driven', () => {
    const video = composePageBuildPackage(vslInputs({ quizSnippetRef: 'quiz-slug' }));
    expect(video.acceptance_criteria.join(' ')).toContain('VideoObject JSON-LD');
    expect(video.acceptance_criteria.join(' ')).toContain('quiz embed');
    expect(video.acceptance_criteria[0]).toContain(`${VSL_BLOCKS.length} copy blocks`);
    expect(video.self_qa_checklist.join(' ')).toContain('structured-data linter');
    expect(video.quiz_embed).toEqual({ snippet_ref: 'quiz-slug' });

    const letter = composePageBuildPackage(
      vslInputs({ scope: { project: ID, market: ID, asset: ID, assetType: 'sales_letter' }, blocks: LETTER_BLOCKS }),
    );
    expect(letter.acceptance_criteria.join(' ')).not.toContain('VideoObject');
    expect(letter.quiz_embed).toBeNull();
  });
});
