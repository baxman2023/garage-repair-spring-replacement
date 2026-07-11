export { env, assertEnv, __resetEnvCache, type Env } from './env.js';
export { newId, type Id } from './id.js';
export { lineDiff, type DiffOp, type DiffOpType } from './diff.js';
export { extractReadableText, type ReadableExtract } from './readability.js';
export { JOB_TYPES, type JobType } from './jobs.js';
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
