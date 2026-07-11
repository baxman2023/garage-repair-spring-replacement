export { getDb, getPool, closePool, type Database } from './client.js';
export { tenantDb, TENANT_TABLES, TENANT_TABLE_NAMES, type TenantDb } from './guard.js';
export {
  enqueueJob,
  claimNextJob,
  heartbeatJob,
  completeJob,
  failJob,
  reapStaleJobs,
  retryDelayMs,
  type EnqueueParams,
  type ClaimedJob,
  type JobError,
} from './queue.js';
export {
  getCurrentProfile,
  listProfileVersions,
  saveProfileVersion,
  type ProductProfileRow,
} from './profiles.js';
export {
  listMarkets,
  applyEngineCandidates,
  swapMarketRanks,
  updateMarket,
  addManualMarket,
  applyMarketProfile,
  MAX_MARKETS,
  type MarketRow,
  type EngineCandidate,
} from './markets.js';
export {
  buildStrategySnapshot,
  recordG2,
  getG2Status,
  assertG2Approved,
  type G2Snapshot,
  type G2Status,
} from './strategyGate.js';
export {
  addVocSource,
  getVocSource,
  listVocSources,
  setVocSourceContent,
  listMarketPhrases,
  insertMarketPhrases,
  type VocSourceRow,
  type VocPhraseRow,
} from './voc.js';
export {
  recordFunnelMathRun,
  latestFunnelMathRun,
  assertG1Passed,
  enqueueGenerationJob,
  type FunnelMathRunRow,
} from './funnelMath.js';
export {
  listOffers,
  saveOfferVariants,
  selectOffer,
  saveOfferEdit,
  recordG0,
  getApprovedOffer,
  type OfferRow,
} from './offers.js';
export {
  getPrompt,
  getPromptById,
  listPromptVersions,
  listPromptNames,
  createPromptVersion,
  activatePromptVersion,
  resolvePromptForGeneration,
  type PromptVersion,
  type CreatePromptVersionInput,
  type ResolvePromptOptions,
} from './prompts.js';
export * as schema from './schema/index.js';
export * from './schema/index.js';
