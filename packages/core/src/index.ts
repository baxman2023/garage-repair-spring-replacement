export { env, assertEnv, __resetEnvCache, type Env } from './env.js';
export { newId, type Id } from './id.js';
export { lineDiff, type DiffOp, type DiffOpType } from './diff.js';
export { extractReadableText, type ReadableExtract } from './readability.js';
export { JOB_TYPES, type JobType } from './jobs.js';
export { canonicalStringify, snapshotHash } from './snapshot.js';
export { AI_TELLS, findAiTells, hasEmDashOveruse } from './aiTells.js';
export {
  FUNNEL_ASSET_SEQUENCE,
  buildFunnelPlan,
  type FunnelAssetType,
  type BuildPlanStep,
} from './buildPlan.js';
export {
  PACKAGE_SCHEMA_VERSION,
  pageBuildPackageSchema,
  parsePageBuildPackage,
  checkG7,
  type PageBuildPackage,
  type PackageDesignBrief,
  type PackageUtmVariant,
} from './contracts/pageBuildPackage.js';
export {
  composePageBuildPackage,
  packageChecksum,
  buildDesignBrief,
  buildVideoObject,
  buildAcceptanceCriteria,
  buildSelfQaChecklist,
  type ComposeInputs,
} from './packageCompose.js';
export {
  COMPLIANCE_RULES,
  packsForMode,
  runCompliancePacks,
  REQUIRED_DISCLAIMERS,
  hasRequiredDisclaimer,
  insertRequiredDisclaimer,
  evaluateCompliance,
  complianceFindingKey,
  type CompliancePack,
  type ComplianceSeverity,
  type ComplianceMode,
  type ComplianceRule,
  type ComplianceFinding,
  type ComplianceVerdict,
} from './compliance.js';
export {
  claimSimilarity,
  rematchClaims,
  buildClaimsFlagReport,
  assertClaimsResolvedForStrictMode,
  CLAIM_REMATCH_THRESHOLD,
  type ClaimLike,
  type RematchedClaim,
  type ClaimsFlagReport,
} from './claimsMatch.js';
export {
  DEFAULT_DESLOP_CONFIG,
  SPOKEN_ASSET_TYPES,
  fleschKincaidGrade,
  specificityDensity,
  sentenceRhythm,
  extractNumberTokens,
  findInventedNumbers,
  measureDeslop,
  evaluateDeslop,
  type DeslopConfig,
  type DeslopMetrics,
  type DeslopVerdict,
  type RhythmStats,
} from './deslop.js';
export {
  DEFAULT_FOCUS_GROUP_CONFIG,
  samplePersonas,
  personaResultSchema,
  focusBatchSchema,
  aggregateFocusGroup,
  composeFocusFixBrief,
  renderFocusReportMarkdown,
  type FocusGroupConfig,
  type FocusPersona,
  type PersonaResult,
  type FocusAnnotation,
  type FocusGroupReport,
} from './focusGroup.js';
export {
  MERGE_FIELDS,
  extractMergeFields,
  findUnknownMergeFields,
  SEQUENCE_KINDS,
  SEQUENCE_SPECS,
  LAUNCH_PHASES,
  sequenceEmailSchema,
  emailSequenceResultSchema,
  validateEmailSequence,
  sequenceGraph,
  type SequenceKind,
  type SequenceEmail,
  type LaunchPhase,
} from './contracts/emailSequence.js';
export {
  SPOKEN_WPM,
  integerToWords,
  numbersToWords,
  stripStageDirections,
  scrubYears,
  applySpokenConventions,
  wordCount,
  blockDurationSeconds,
  timestampBlocks,
  totalDurationSeconds,
} from './spokenScript.js';
export {
  ASSET_STATUSES,
  canTransition,
  assertTransition,
  type AssetStatus,
} from './assetStatus.js';
export {
  mergeRegeneratedBlocks,
  diffBlocks,
  type AssetBlock,
  type AssetBlockMeta,
  type BlockDiff,
  type BlockChange,
} from './blocks.js';
export {
  COUNCIL_LENSES,
  lensResultSchema,
  parseLensResult,
  DEFAULT_COUNCIL_CONFIG,
  WEIGHT_MIN,
  WEIGHT_MAX,
  clampWeights,
  aggregateCouncil,
  composeRevisionNotes,
  type CouncilLens,
  type LensResult,
  type CouncilConfig,
  type CouncilVerdict,
} from './council.js';
export {
  componentWeight,
  rankComponents,
  estimateTokens,
  genomePromptBlock,
  GENOME_RECENCY_HALF_LIFE_DAYS,
  GENOME_BLOCK_TOKEN_BUDGET,
  type RetrievableComponent,
  type GenomeBlockResult,
} from './genomeBlock.js';
export { extractJsonObject } from './jsonExtract.js';
export {
  computeFunnelMath,
  funnelMathInputsSchema,
  channelInputSchema,
  BENCHMARK_CVRS,
  DEFAULT_CVR,
  type FunnelMathInputs,
  type FunnelMathReport,
  type FunnelMathFix,
  type ChannelProjection,
} from './funnelMath.js';
export {
  STARVING_CROWD_WEIGHTS,
  starvingCrowdScoresSchema,
  marketCandidateSchema,
  marketSelectionResultSchema,
  parseMarketSelectionResult,
  scoreMarket,
  rankCandidates,
  type StarvingCrowdScores,
  type MarketCandidate,
  type MarketSelectionResult,
  type RankedCandidate,
  type ScoreDimension,
} from './contracts/market.js';
export {
  BLOCK_ROLES,
  generatedBlockSchema,
  generatedBlocksSchema,
  parseGeneratedBlocks,
  extractedClaimsSchema,
  parseExtractedClaims,
  TARGET_LENGTHS,
  type BlockRole,
  type GeneratedBlocks,
} from './contracts/assetBlocks.js';
export {
  GENOME_COMPONENT_TYPES as GENOME_TYPES,
  genomeComponentSchema,
  parseGenomeDecomposition,
  type GenomeComponent,
  type GenomeDecomposition,
} from './contracts/genome.js';
export {
  MARKET_PROFILE_SCHEMA_VERSION,
  AWARENESS_STAGES_ORDER,
  marketProfileSchema,
  parseMarketProfile,
  marketProfilePromptBlock,
  type MarketProfile,
} from './contracts/marketProfile.js';
export {
  VOC_PHRASE_KINDS,
  vocExtractedPhraseSchema,
  vocExtractionResultSchema,
  parseVocExtractionResult,
  normalizePhrase,
  dedupePhrases,
  vocCorpusPromptBlock,
  vocQuoteRate,
  type VocPhraseKind,
  type VocExtractedPhrase,
  type CorpusPhrase,
  type VocQuoteReport,
} from './contracts/voc.js';
export {
  OFFER_SCHEMA_VERSION,
  URGENCY_TYPES,
  offerSchema,
  urgencyMechanismSchema,
  valueStackItemSchema,
  offerForgeResultSchema,
  parseOffer,
  parseOfferForgeResult,
  checkG0,
  type Offer,
  type OfferForgeResult,
  type UrgencyType,
  type G0Report,
} from './contracts/offer.js';
export {
  PROFILE_SCHEMA_VERSION,
  productProfileSchema,
  proofAssetSchema,
  emptyProductProfile,
  parseProductProfile,
  mergeProductProfiles,
  applyIntakeAnswer,
  unansweredProfileFields,
  INTAKE_QUESTIONS,
  type ProductProfile,
  type IntakeQuestion,
} from './contracts/productProfile.js';
