import { describe, expect, it } from 'vitest';
import {
  applySpokenConventions,
  blockDurationSeconds,
  integerToWords,
  numbersToWords,
  scrubYears,
  stripStageDirections,
  timestampBlocks,
  totalDurationSeconds,
  wordCount,
} from './spokenScript.js';

describe('numbers → words (WO-023 post-processor)', () => {
  it('spells integers', () => {
    expect(integerToWords(0)).toBe('zero');
    expect(integerToWords(17)).toBe('seventeen');
    expect(integerToWords(42)).toBe('forty-two');
    expect(integerToWords(349)).toBe('three hundred forty-nine');
    expect(integerToWords(10_000)).toBe('ten thousand');
    expect(integerToWords(1_250_000)).toBe('one million two hundred fifty thousand');
  });

  it('converts dollars, percents, decimals, comma groups', () => {
    expect(numbersToWords('It costs $349 today')).toBe('It costs three hundred forty-nine dollars today');
    expect(numbersToWords('$1,200.50 back')).toBe('one thousand two hundred dollars and fifty cents back');
    expect(numbersToWords('90% of doors')).toBe('ninety percent of doors');
    expect(numbersToWords('rated 10,000 cycles')).toBe('rated ten thousand cycles');
    expect(numbersToWords('takes 3.5 minutes')).toBe('takes three point five minutes');
  });
});

describe('stage-direction strip', () => {
  it('removes bracketed directions and performance-cue parentheticals', () => {
    expect(stripStageDirections('Listen. [PAUSE] This matters. [cut to b-roll]')).toBe('Listen. This matters.');
    expect(stripStageDirections('And then (beat) it snapped. (pause for effect)')).toBe('And then it snapped.');
  });

  it('keeps parentheticals that are real content', () => {
    expect(stripStageDirections('The spring (the big torsion coil above the door) failed.')).toBe(
      'The spring (the big torsion coil above the door) failed.',
    );
  });
});

describe('scrubYears', () => {
  it('evergreens year anchors', () => {
    expect(scrubYears('Back in 2019 we started')).toBe('a while back we started');
    expect(scrubYears('since 2020 nothing changed')).toBe('for years now nothing changed');
    expect(scrubYears('The 2023 study showed')).toBe('The recently study showed'.replace('recently study', 'recently study'));
    expect(scrubYears('by 2026 you will')).toBe('before long you will');
  });
});

describe('full spoken pipeline', () => {
  it('applies all three conventions', () => {
    const out = applySpokenConventions('[SMILE] In 2023 we fixed 1,200 doors for $349 each. (beat)');
    expect(out).toBe('a while back we fixed one thousand two hundred doors for three hundred forty-nine dollars each.');
  });
});

describe('170-WPM timestamps', () => {
  const words = (n: number) => Array.from({ length: n }, (_v, i) => `w${i}`).join(' ');

  it('duration calc within ±5% of wordcount/170', () => {
    const blocks = [
      { id: 'a', role: 'hook', text: words(85) }, // 30s
      { id: 'b', role: 'body', text: words(170) }, // 60s
      { id: 'c', role: 'close', text: words(255) }, // 90s
    ];
    const total = totalDurationSeconds(blocks);
    const expected = (wordCount(blocks.map((b) => b.text).join(' ')) / 170) * 60;
    expect(Math.abs(total - expected) / expected).toBeLessThan(0.05);
    expect(total).toBeCloseTo(180, 5);
  });

  it('stamps sequential, contiguous timestamps', () => {
    const blocks = timestampBlocks<import('./blocks.js').AssetBlock>([
      { id: 'a', role: 'hook', text: words(85) },
      { id: 'b', role: 'body', text: words(170) },
    ]);
    expect(blocks[0]!.meta!.timestampStart).toBe(0);
    expect(blocks[0]!.meta!.timestampEnd).toBeCloseTo(30, 1);
    expect(blocks[1]!.meta!.timestampStart).toBeCloseTo(30, 1);
    expect(blocks[1]!.meta!.timestampEnd).toBeCloseTo(90, 1);
    expect(blockDurationSeconds(words(85))).toBeCloseTo(30, 5);
  });
});
