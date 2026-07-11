/**
 * Stable domain vocabulary for AI routing & caching (spec §1.1–§1.2).
 * Stage identifiers are fixed domain concepts (not config); model ids they map
 * to always live in the `model_routes` config table, never hardcoded.
 */

/** Pipeline stages that select a model route (spec §1.1). */
export const STAGES = [
  'classification',
  'voc_extraction',
  'claims_extraction',
  'scrub',
  'asset_drafting',
  'council',
  'focus_group',
  'autopsy',
  'offer_forge',
  'market_selection',
] as const;

export type Stage = (typeof STAGES)[number];

/** Cache-block roles, ordered largest/most-stable first (spec §1.2). */
export const CACHE_BLOCK_ROLES = [
  'council_persona_corpus',
  'genome_retrieval',
  'market_profile',
  'dynamic_user',
] as const;

export type CacheBlockRole = (typeof CACHE_BLOCK_ROLES)[number];
