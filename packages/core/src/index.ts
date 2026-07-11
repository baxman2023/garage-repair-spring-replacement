export { env, assertEnv, __resetEnvCache, type Env } from './env.js';
export { newId, type Id } from './id.js';
export { lineDiff, type DiffOp, type DiffOpType } from './diff.js';
export { extractReadableText, type ReadableExtract } from './readability.js';
export { JOB_TYPES, type JobType } from './jobs.js';
export { extractJsonObject } from './jsonExtract.js';
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
