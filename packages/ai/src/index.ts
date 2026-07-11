/**
 * @copyforge/ai — the single choke point for all Anthropic calls.
 *
 * Model ids always live in the `model_routes` config table and are never
 * hardcoded here; this package resolves them per stage, applies the fallback
 * chain, builds cache-control blocks (spec §1.2), and meters usage.
 */

export { STAGES, CACHE_BLOCK_ROLES, type Stage, type CacheBlockRole } from './stages.js';

export {
  createClient,
  aiClient,
  generate,
  type GenerateParams,
  type GenerateResult,
  type ClientOptions,
} from './client.js';

export {
  anthropicTransport,
  toSystemParam,
  isOverloaded,
  type Transport,
  type AnthropicRequest,
  type AnthropicResult,
  type SystemBlock,
  type ChatMessage,
  type UsageResult,
} from './transport.js';

export { MockTransport, type RecordedCall } from './mock.js';

export { PRICING, DEFAULT_PRICE, estimateCostUsd, type ModelPrice } from './pricing.js';

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
