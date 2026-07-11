import { z } from 'zod';

/**
 * Voice-of-customer mining (WO-014). Haiku extracts typed phrases from raw
 * sources; phrases are deduped by normalized text per market and rendered
 * into a generation cache block. `vocQuoteRate` is the spot-check harness
 * generator tests use to prove output actually quotes the corpus.
 */

export const VOC_PHRASE_KINDS = ['pain', 'desire', 'objection', 'identity'] as const;
export type VocPhraseKind = (typeof VOC_PHRASE_KINDS)[number];

export const vocExtractedPhraseSchema = z.object({
  phrase: z.string().trim().min(3),
  kind: z.enum(VOC_PHRASE_KINDS),
});
export type VocExtractedPhrase = z.infer<typeof vocExtractedPhraseSchema>;

export const vocExtractionResultSchema = z.object({
  phrases: z.array(vocExtractedPhraseSchema).min(1),
});

export function parseVocExtractionResult(data: unknown): z.infer<typeof vocExtractionResultSchema> {
  return vocExtractionResultSchema.parse(data);
}

/** Normalization key for dedupe: casefold, strip punctuation, collapse spaces. */
export function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/['’‘"”“]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Dedupe new phrases against themselves and an existing corpus. */
export function dedupePhrases(
  incoming: VocExtractedPhrase[],
  existing: string[] = [],
): VocExtractedPhrase[] {
  const seen = new Set(existing.map(normalizePhrase));
  const out: VocExtractedPhrase[] = [];
  for (const p of incoming) {
    const key = normalizePhrase(p.phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export interface CorpusPhrase {
  phrase: string;
  kind: VocPhraseKind;
}

/**
 * Render the VOC corpus cache block injected into generation prompts
 * (spec §1.2 — part of the stable per-market block stack).
 */
export function vocCorpusPromptBlock(phrases: CorpusPhrase[], maxPerKind = 50): string {
  const byKind = new Map<VocPhraseKind, string[]>();
  for (const kind of VOC_PHRASE_KINDS) byKind.set(kind, []);
  for (const p of phrases) {
    const bucket = byKind.get(p.kind);
    if (bucket && bucket.length < maxPerKind) bucket.push(p.phrase);
  }
  const sections = VOC_PHRASE_KINDS.filter((k) => byKind.get(k)!.length > 0).map((kind) =>
    [`${kind.toUpperCase()} — in their own words:`, ...byKind.get(kind)!.map((p) => `- "${p}"`)].join('\n'),
  );
  return [
    'VOICE OF CUSTOMER CORPUS (quote these people verbatim where possible — this is how the market actually talks):',
    ...sections,
  ].join('\n\n');
}

export interface VocQuoteReport {
  quoted: string[];
  rate: number;
}

/**
 * Spot-check harness (WO-014 acceptance): what fraction of corpus phrases are
 * demonstrably quoted (normalized substring) in a generated text.
 */
export function vocQuoteRate(generatedText: string, phrases: string[]): VocQuoteReport {
  const haystack = normalizePhrase(generatedText);
  const quoted = phrases.filter((p) => {
    const needle = normalizePhrase(p);
    return needle.length > 0 && haystack.includes(needle);
  });
  return { quoted, rate: phrases.length === 0 ? 0 : quoted.length / phrases.length };
}
