/**
 * AI-tell scrub list (spec §5 G5 / WO-030), shared config. WO-026 uses it to
 * gate email subjects at generation time; WO-030's De-Slop gate runs the same
 * list over full asset bodies. Config, not code: extend the list, not the
 * matcher.
 */

/** Phrases that mark machine-written copy. Matched case-insensitively on word boundaries. */
export const AI_TELLS: readonly string[] = [
  'delve',
  'delving',
  'unlock the',
  'unlocking the',
  'unleash',
  'navigate the complexities',
  'navigating the complexities',
  'in today’s world',
  "in today's world",
  'in today’s fast-paced',
  "in today's fast-paced",
  'in the ever-evolving',
  'ever-evolving landscape',
  'game-changer',
  'game changer',
  'revolutionize the way',
  'take your * to the next level',
  'look no further',
  'elevate your',
  'embark on a journey',
  'dive into',
  'a testament to',
  'seamlessly',
  'furthermore',
  'moreover',
  'it is important to note',
  'in conclusion',
  'whether you’re a * or a *',
  "whether you're a * or a *",
  'buckle up',
  'the world of',
  'say goodbye to',
  'say hello to',
  'supercharge',
  'skyrocket your',
];

function tellToRegex(tell: string): RegExp {
  // `*` in a tell is a small wildcard: one to four words.
  const escaped = tell
    .split('*')
    .map((part) => part.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+(?:\\S+\\s+){0,3}\\S+\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

const TELL_PATTERNS = AI_TELLS.map((tell) => ({ tell, re: tellToRegex(tell) }));

/** Every AI-tell present in the text (deduplicated, list order). */
export function findAiTells(text: string): string[] {
  const hits: string[] = [];
  for (const { tell, re } of TELL_PATTERNS) {
    if (re.test(text)) hits.push(tell);
  }
  return hits;
}

/**
 * Em-dash overuse (spec WO-030 names it a tell): flags more than one em-dash
 * per forty words, with a two-dash allowance for short texts.
 */
export function hasEmDashOveruse(text: string): boolean {
  const dashes = (text.match(/—/g) ?? []).length;
  if (dashes <= 2) return false;
  const words = text.split(/\s+/).filter(Boolean).length;
  return dashes > words / 40;
}
