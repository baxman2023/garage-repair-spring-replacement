import type { AssetBlock } from './blocks.js';

/**
 * Spoken-script conventions (spec §1 / WO-023): 170 WPM timing basis,
 * numbers spelled as words, NO stage directions, scrubYears() evergreening.
 * Pure, unit-tested post-processing applied to all spoken output.
 */

export const SPOKEN_WPM = 170;

// --- numbers → words ---------------------------------------------------------

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function integerToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`integerToWords expects a non-negative integer, got ${n}`);
  }
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)]!;
    return n % 10 ? `${tens}-${ONES[n % 10]}` : tens;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${integerToWords(rest)}` : ''}`;
  }
  const scales: Array<[number, string]> = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ];
  for (const [scale, name] of scales) {
    if (n >= scale) {
      const head = integerToWords(Math.floor(n / scale));
      const rest = n % scale;
      return `${head} ${name}${rest ? ` ${integerToWords(rest)}` : ''}`;
    }
  }
  throw new Error(`integerToWords out of range: ${n}`);
}

function digitsToInt(digits: string): number {
  return parseInt(digits.replace(/,/g, ''), 10);
}

/**
 * Convert digit tokens to words: `$349` → "three hundred forty-nine dollars",
 * `10,000` → "ten thousand", `90%` → "ninety percent", `3.5` → "three point
 * five". Run {@link scrubYears} BEFORE this, or years get spelled as words.
 */
export function numbersToWords(text: string): string {
  return (
    text
      // $1,234.56 / $349
      .replace(/\$([\d,]+)(?:\.(\d{2}))?/g, (_m, whole: string, cents?: string) => {
        const dollars = integerToWords(digitsToInt(whole));
        return cents && cents !== '00'
          ? `${dollars} dollars and ${integerToWords(parseInt(cents, 10))} cents`
          : `${dollars} dollars`;
      })
      // 90% / 12.5%
      .replace(/([\d,]+(?:\.\d+)?)%/g, (_m, num: string) => `${plainNumberToWords(num)} percent`)
      // bare numbers incl. decimals and comma groups
      .replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (m) => plainNumberToWords(m))
  );
}

function plainNumberToWords(token: string): string {
  const [whole, frac] = token.split('.');
  const wholeWords = integerToWords(digitsToInt(whole!));
  if (frac === undefined) return wholeWords;
  const fracWords = frac.split('').map((d) => ONES[parseInt(d, 10)]).join(' ');
  return `${wholeWords} point ${fracWords}`;
}

// --- stage directions --------------------------------------------------------

const CUE_WORDS =
  /^(pause|beat|laughs?|smiles?|music|sfx|vo|voice ?over|cut|b-?roll|on screen|camera|zoom|fade|transition|gesture|point(s|ing)? at)/i;

/** Remove [bracketed] directions and (parenthetical) performance cues. */
export function stripStageDirections(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, (m, inner: string) => (CUE_WORDS.test(inner.trim()) ? ' ' : m))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .trim();
}

// --- year scrubbing ----------------------------------------------------------

/**
 * scrubYears (spec §1): evergreen all spoken output. Phrases anchored to a
 * calendar year become relative; bare years become "recently".
 */
export function scrubYears(text: string): string {
  return text
    .replace(/\b(?:back |way )?in (?:19|20)\d{2}\b/gi, 'a while back')
    .replace(/\bsince (?:19|20)\d{2}\b/gi, 'for years now')
    .replace(/\bby (?:19|20)\d{2}\b/gi, 'before long')
    .replace(/\b(?:19|20)\d{2}\b/g, 'recently');
}

/** The full spoken pipeline: strip directions → scrub years → numbers to words. */
export function applySpokenConventions(text: string): string {
  // Years scrub BEFORE digit conversion, or "2023" becomes words and escapes it.
  return numbersToWords(scrubYears(stripStageDirections(text)));
}

// --- 170-WPM timestamps -------------------------------------------------------

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Seconds a block takes to speak at the 170-WPM basis. */
export function blockDurationSeconds(text: string, wpm: number = SPOKEN_WPM): number {
  return (wordCount(text) / wpm) * 60;
}

/** Stamp sequential timestampStart/End (seconds, 1dp) onto blocks. */
export function timestampBlocks<T extends AssetBlock>(blocks: T[], wpm: number = SPOKEN_WPM): T[] {
  let cursor = 0;
  return blocks.map((block) => {
    const duration = blockDurationSeconds(block.text, wpm);
    const stamped = {
      ...block,
      meta: {
        ...block.meta,
        timestampStart: Math.round(cursor * 10) / 10,
        timestampEnd: Math.round((cursor + duration) * 10) / 10,
      },
    };
    cursor += duration;
    return stamped;
  });
}

/** Total spoken duration in seconds. */
export function totalDurationSeconds(blocks: AssetBlock[], wpm: number = SPOKEN_WPM): number {
  return blocks.reduce((s, b) => s + blockDurationSeconds(b.text, wpm), 0);
}
