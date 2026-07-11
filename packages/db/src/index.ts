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
  resolveProjectById,
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
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  listAssetVersions,
  insertAssetVersion,
  insertCouncilReviews,
  listCouncilReviewsForAsset,
  recordAssetGate,
  setAssetStatus,
  transitionAssetStatus,
  insertClaims,
  listClaims,
  listCurrentClaims,
  attachClaimProof,
  resetClaimToFlagged,
  claimsFlagReport,
  type AssetRow,
  type AssetVersionRow,
  type CouncilReviewRow,
} from './assetsStore.js';
export { seedGenomeCorpus } from './seedGenome.js';
export {
  saveHarvestQuery,
  listHarvestQueries,
  getHarvestQuery,
  recordHarvestResult,
  triggerHarvest,
  hasGenomeFeedEntitlement,
  scheduleHarvest,
  type HarvestQueryRow,
} from './harvest.js';
export {
  addSwipe,
  getSwipe,
  listSwipes,
  updateSwipeSource,
  insertGenomeComponents,
  queryGenomeComponents,
  retrieveGenome,
  createGenomePack,
  listGenomePacks,
  resolveGenomePack,
  type GenomePackRow,
  type GenomePackDefinition,
  type GenomeRetrievalQuery,
  type SwipeRow,
  type GenomeComponentRow,
  type ComponentQuery,
} from './genome.js';
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
export {
  saveQuizDefinition,
  getQuizForProject,
  getQuizBySlug,
  updateQuizDefinition,
  type QuizDefinitionRow,
} from './quizStore.js';
export {
  recordExport,
  listExportsForAsset,
  listExportsForMarket,
  type ExportRow,
} from './exportsStore.js';
export {
  savePackage,
  latestPackage,
  updatePackageRenderings,
  type PackageRow,
} from './packagesStore.js';
export {
  ASSET_GATES,
  projectGateGrid,
  gateReportDetail,
  overrideGate,
  blockAsset,
  approveAsset,
  type AssetGate,
  type GateCell,
  type GateGridRow,
} from './gatesDashboard.js';
export {
  COMPLIANCE_ACK_ACTION,
  recordComplianceAck,
  listComplianceAckKeys,
} from './complianceStore.js';
export {
  insertFocusGroupRun,
  latestFocusGroupRun,
  type FocusGroupRunRow,
} from './focusGroupStore.js';
export {
  startFunnelBuild,
  enqueueBuildStep,
  getBuild,
  getBuildStep,
  listBuildSteps,
  updateBuildStep,
  setBuildStatus,
  cancelFunnelBuild,
  resumeFunnelBuild,
  buildCacheStats,
  latestBuild,
  type FunnelBuildRow,
  type FunnelBuildStepRow,
  type BuildCacheStats,
} from './builds.js';
export * as schema from './schema/index.js';
export * from './schema/index.js';
