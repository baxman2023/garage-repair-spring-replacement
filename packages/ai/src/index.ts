/**
 * @copyforge/ai — the single choke point for all Anthropic calls.
 *
 * The full client wrapper, model router, cache-block builders, and usage
 * metering land in WO-006. This module currently defines the stable domain
 * vocabulary those pieces build on: the pipeline *stages* that map to models
 * via the `model_routes` config table (spec §1.1). Stage identifiers are
 * fixed domain concepts, not configuration — model ids, by contrast, always
 * live in config and are never hardcoded here.
 */

/**
 * Pipeline stages that select a model route (spec §1.1). Each stage resolves
 * to a concrete model id through the `model_routes` table at call time.
 */
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

export {
  encryptSecret,
  decryptSecret,
  storeWorkspaceKey,
  getWorkspaceKey,
  getWorkspaceKeyMeta,
  requireWorkspaceKey,
  deleteWorkspaceKey,
  testWorkspaceKey,
  defaultAnthropicPing,
  type EncryptedSecret,
  type KeyMeta,
  type Pinger,
  type TestKeyResult,
} from './vault.js';
export { redact, installConsoleRedaction, REDACTED } from './redact.js';
export { WorkspaceKeyError } from './errors.js';
