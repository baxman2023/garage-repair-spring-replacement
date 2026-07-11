import { findAiTells, hasEmDashOveruse } from './aiTells.js';
import { integerToWords } from './spokenScript.js';

/**
 * De-Slop measures — gate G5 (WO-030, pure parts). §5: Flesch-Kincaid grade
 * 5–7 (spoken) / 5–8 (written); zero AI-tell hits; specificity density ≥
 * threshold; voice-match ≥ threshold when founder samples exist. The
 * specificity injector may only use numbers/names already present in the
 * profile/VOC corpus — {@link findInventedNumbers} is the guard.
 */

export interface DeslopConfig {
  gradeBand: { spoken: [number, number]; written: [number, number] };
  /** Specificity markers per 100 words. */
  minSpecificityDensity: number;
  /** Coefficient of variation of sentence length (rhythm). */
  minRhythmVariance: number;
  /** Voice-match score 0–100; applied only when founder samples exist. */
  minVoiceMatch: number;
  maxRewriteLoops: number;
}

export const DEFAULT_DESLOP_CONFIG: DeslopConfig = {
  gradeBand: { spoken: [5, 7], written: [5, 8] },
  minSpecificityDensity: 1.5,
  minRhythmVariance: 0.35,
  minVoiceMatch: 70,
  maxRewriteLoops: 3,
};

/** Asset types measured against the SPOKEN grade band. */
export const SPOKEN_ASSET_TYPES = new Set(['vsl', 'short_form_video', 'webinar', 'youtube_ad']);

// --- Flesch-Kincaid ------------------------------------------------------------

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:ed|es|e)$/, '').replace(/^y/, '');
  const groups = stripped.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).some((w) => /[a-zA-Z]/.test(w)));
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
}

/** Flesch-Kincaid grade level (deterministic syllable heuristic). */
export function fleschKincaidGrade(text: string): number {
  const sentences = splitSentences(text);
  const ws = words(text);
  if (sentences.length === 0 || ws.length === 0) return 0;
  const syllables = ws.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade = 0.39 * (ws.length / sentences.length) + 11.8 * (syllables / ws.length) - 15.59;
  return Math.max(0, Math.round(grade * 100) / 100);
}

// --- Specificity ---------------------------------------------------------------

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/gi;
const UNITS = /\b(dollars?|percent|%|\$|minutes?|hours?|days?|weeks?|years?|cycles?|pounds?|feet|inch(?:es)?|miles?)\b/gi;

/**
 * Specificity markers per 100 words: digits, spelled numbers, measurement
 * units, and mid-sentence proper nouns (names). Deterministic heuristic.
 */
export function specificityDensity(text: string): number {
  const ws = words(text);
  if (ws.length === 0) return 0;
  const digits = (text.match(/\d+(?:[.,]\d+)*/g) ?? []).length;
  const spelled = (text.match(NUMBER_WORDS) ?? []).length;
  const units = (text.match(UNITS) ?? []).length;
  // Proper nouns: capitalized words NOT at a sentence start.
  let proper = 0;
  for (const sentence of splitSentences(text)) {
    const sw = sentence.split(/\s+/).filter(Boolean);
    for (let i = 1; i < sw.length; i++) {
      if (/^[A-Z][a-z]+/.test(sw[i]!) && !/[.!?]$/.test(sw[i - 1]!)) proper++;
    }
  }
  return ((digits + spelled + units + proper) / ws.length) * 100;
}

// --- Sentence rhythm -------------------------------------------------------------

export interface RhythmStats {
  sentenceCount: number;
  meanLength: number;
  /** Coefficient of variation (stdev / mean) of sentence word counts. */
  variance: number;
}

export function sentenceRhythm(text: string): RhythmStats {
  const lengths = splitSentences(text).map((s) => words(s).length);
  if (lengths.length === 0) return { sentenceCount: 0, meanLength: 0, variance: 0 };
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const stdev = Math.sqrt(lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length);
  return {
    sentenceCount: lengths.length,
    meanLength: Math.round(mean * 100) / 100,
    variance: mean === 0 ? 0 : Math.round((stdev / mean) * 100) / 100,
  };
}

// --- Invented-specifics guard ----------------------------------------------------

/** Canonical number tokens (digits AND spelled forms) present in a text. */
export function extractNumberTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const canonical = m.replace(/,/g, '');
    tokens.add(canonical);
    const n = Number(canonical);
    if (Number.isInteger(n) && n >= 0 && n <= 1_000_000_000) {
      tokens.add(integerToWords(n).replace(/-/g, ' '));
    }
  }
  // Spelled number phrases (greedy runs of number words).
  for (const m of text.toLowerCase().match(/\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[-\s]+|$))+\b/g) ?? []) {
    const phrase = m.trim().replace(/[-\s]+/g, ' ');
    if (phrase) tokens.add(phrase);
  }
  return tokens;
}

/**
 * The injector guard (WO-030 acceptance): every number in the rewrite must
 * already exist in the source corpus (original draft + profile + VOC +
 * claims). Returns the invented tokens (empty = clean).
 */
export function findInventedNumbers(rewritten: string, corpus: string): string[] {
  const allowed = extractNumberTokens(corpus);
  const pad = (s: string) => ` ${s} `;
  const isAllowed = (token: string): boolean => {
    if (allowed.has(token)) return true;
    // A token counts only as a word-bounded SUB-phrase of an allowed phrase
    // ("one" inside "one hundred"). The reverse ("ninety seven" because the
    // corpus has "seven") would let the injector smuggle new numbers in.
    for (const a of allowed) {
      if (pad(a).includes(pad(token))) return true;
    }
    return false;
  };
  return [...extractNumberTokens(rewritten)].filter((t) => !isAllowed(t));
}

// --- Verdict ----------------------------------------------------------------------

export interface DeslopMetrics {
  grade: number;
  tells: string[];
  emDashOveruse: boolean;
  specificityDensity: number;
  rhythm: RhythmStats;
  voiceMatch: number | null;
}

export interface DeslopVerdict {
  pass: boolean;
  failures: string[];
  metrics: DeslopMetrics;
  band: [number, number];
}

export function measureDeslop(text: string, voiceMatch: number | null = null): DeslopMetrics {
  return {
    grade: fleschKincaidGrade(text),
    tells: findAiTells(text),
    emDashOveruse: hasEmDashOveruse(text),
    specificityDensity: Math.round(specificityDensity(text) * 100) / 100,
    rhythm: sentenceRhythm(text),
    voiceMatch,
  };
}

export function evaluateDeslop(params: {
  metrics: DeslopMetrics;
  spoken: boolean;
  /** Voice threshold applies only when founder samples exist. */
  hasVoiceSamples: boolean;
  config?: DeslopConfig;
}): DeslopVerdict {
  const config = params.config ?? DEFAULT_DESLOP_CONFIG;
  const band = params.spoken ? config.gradeBand.spoken : config.gradeBand.written;
  const m = params.metrics;
  const failures: string[] = [];

  if (m.grade < band[0] || m.grade > band[1]) {
    failures.push(
      `Readability grade ${m.grade} is outside the ${params.spoken ? 'spoken' : 'written'} band ${band[0]}-${band[1]}.`,
    );
  }
  if (m.tells.length > 0) failures.push(`AI-tell hits: ${m.tells.join(', ')}.`);
  if (m.emDashOveruse) failures.push('Em-dash overuse.');
  if (m.specificityDensity < config.minSpecificityDensity) {
    failures.push(
      `Specificity density ${m.specificityDensity} below threshold ${config.minSpecificityDensity} (markers per 100 words).`,
    );
  }
  if (m.rhythm.sentenceCount >= 3 && m.rhythm.variance < config.minRhythmVariance) {
    failures.push(
      `Sentence rhythm too uniform (variance ${m.rhythm.variance} < ${config.minRhythmVariance}).`,
    );
  }
  if (params.hasVoiceSamples && m.voiceMatch !== null && m.voiceMatch < config.minVoiceMatch) {
    failures.push(`Voice-match score ${m.voiceMatch} below threshold ${config.minVoiceMatch}.`);
  }

  return { pass: failures.length === 0, failures, metrics: m, band };
}
