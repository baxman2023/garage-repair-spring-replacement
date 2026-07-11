import { z } from 'zod';
import { starvingCrowdScoresSchema } from './market.js';

/**
 * market_profile.json contract (spec §4 + WO-013's justification lines).
 * Strict by design: a profile only parses when the Schwartz diagnosis is
 * complete — generators depend on these fields being present.
 */

export const MARKET_PROFILE_SCHEMA_VERSION = '1';

export const AWARENESS_STAGES_ORDER = ['unaware', 'problem', 'solution', 'product', 'most'] as const;

const nonEmpty = z.string().trim().min(1);

export const marketProfileSchema = z.object({
  schema_version: z.string().default(MARKET_PROFILE_SCHEMA_VERSION),
  rank: z.number().int().min(1).max(5),
  label: nonEmpty,
  avatar: z.object({
    age_range: nonEmpty,
    identity: nonEmpty,
    situation: nonEmpty,
  }),
  starving_crowd_scores: starvingCrowdScoresSchema.extend({
    total: z.number().min(0).max(100),
  }),
  awareness_stage: z.enum(AWARENESS_STAGES_ORDER),
  /** One-line justification (WO-013 deliverable). */
  awareness_justification: nonEmpty,
  sophistication: z.number().int().min(1).max(5),
  /** One-line justification (WO-013 deliverable). */
  sophistication_justification: nonEmpty,
  resident_emotion: nonEmpty,
  core_desire: nonEmpty,
  objections: z.array(nonEmpty).min(5),
  voc_corpus_ref: z.string().default(''),
  channels_ranked: z.array(nonEmpty).min(1),
  /** The sentence already running in their head. */
  entry_conversation: nonEmpty,
});

export type MarketProfile = z.infer<typeof marketProfileSchema>;

export function parseMarketProfile(data: unknown): MarketProfile {
  return marketProfileSchema.parse(data);
}

/**
 * Render the market-profile cache block (spec §1.2 block 3) used by every
 * generator and Council call for this market. Throws if the diagnosis is
 * incomplete — this is the assertion point WO-013's acceptance names: no
 * generation prompt can be built from an undiagnosed market.
 */
export function marketProfilePromptBlock(profile: MarketProfile): string {
  const parsed = marketProfileSchema.parse(profile);
  return [
    `MARKET PROFILE — ${parsed.label} (rank ${parsed.rank})`,
    ``,
    `Avatar: ${parsed.avatar.identity}, ${parsed.avatar.age_range} — ${parsed.avatar.situation}`,
    `Awareness stage: ${parsed.awareness_stage} — ${parsed.awareness_justification}`,
    `Sophistication: ${parsed.sophistication}/5 — ${parsed.sophistication_justification}`,
    `Resident emotion: ${parsed.resident_emotion}`,
    `Core desire: ${parsed.core_desire}`,
    `Entry conversation (already in their head): "${parsed.entry_conversation}"`,
    ``,
    `Objections:`,
    ...parsed.objections.map((o) => `- ${o}`),
    ``,
    `Channels (ranked): ${parsed.channels_ranked.join(' > ')}`,
    `Starving-crowd score: ${parsed.starving_crowd_scores.total}/100`,
  ].join('\n');
}
