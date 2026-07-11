import { describe, expect, it } from 'vitest';
import { marketProfilePromptBlock, parseMarketProfile } from './marketProfile.js';

const FULL = {
  schema_version: '1',
  rank: 1,
  label: 'New homeowners with builder-grade springs at end-of-life',
  avatar: {
    age_range: '30-45',
    identity: 'first-time suburban homeowner',
    situation: 'door started screeching; car gets trapped some mornings',
  },
  starving_crowd_scores: {
    pain: 8,
    purchasing_power: 7,
    reachability: 6,
    urgency: 8,
    ltv: 4,
    total: 71.5,
  },
  awareness_stage: 'problem',
  awareness_justification: 'They feel the symptom daily but do not know springs are the cause.',
  sophistication: 2,
  sophistication_justification: 'Almost no prior exposure to garage-repair marketing claims.',
  resident_emotion: 'quiet dread of the door failing with the car inside',
  core_desire: 'never think about the garage door again',
  objections: [
    'I can probably fix this myself with a YouTube video',
    'Repair companies always upsell you a whole new door',
    'How do I know the new spring is not the same cheap part',
    '$349 feels steep for a spring',
    'I do not know which companies are legit',
  ],
  voc_corpus_ref: '',
  channels_ranked: ['search', 'meta', 'nextdoor'],
  entry_conversation: 'That screech again — is this thing going to snap on me?',
};

describe('market_profile contract (WO-013)', () => {
  it('parses a complete profile', () => {
    const p = parseMarketProfile(FULL);
    expect(p.awareness_stage).toBe('problem');
    expect(p.objections.length).toBe(5);
  });

  it('rejects incomplete diagnoses (strict: no empty fields, ≥5 objections)', () => {
    expect(() => parseMarketProfile({ ...FULL, awareness_justification: ' ' })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, sophistication_justification: '' })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, entry_conversation: '' })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, resident_emotion: '' })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, objections: FULL.objections.slice(0, 4) })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, channels_ranked: [] })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, awareness_stage: 'kinda-aware' })).toThrow();
    expect(() => parseMarketProfile({ ...FULL, sophistication: 6 })).toThrow();
  });

  it('prompt block carries every diagnosis field generators depend on', () => {
    const block = marketProfilePromptBlock(parseMarketProfile(FULL));
    expect(block).toContain('Awareness stage: problem');
    expect(block).toContain(FULL.awareness_justification);
    expect(block).toContain('Sophistication: 2/5');
    expect(block).toContain(FULL.resident_emotion);
    expect(block).toContain(FULL.entry_conversation);
    for (const objection of FULL.objections) expect(block).toContain(objection);
    expect(block).toContain('search > meta > nextdoor');
  });

  it('prompt block cannot be built from an undiagnosed market (G3 input assertion)', () => {
    expect(() =>
      marketProfilePromptBlock({ ...FULL, awareness_justification: '' } as never),
    ).toThrow();
  });
});
