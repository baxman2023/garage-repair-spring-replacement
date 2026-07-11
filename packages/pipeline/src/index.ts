/**
 * @copyforge/pipeline — the generator/gate job handlers shared by the worker
 * (queue-driven) and the produce CLI (inline, headless). One implementation,
 * two drivers.
 */
export { createIntakeHandler, INTAKE_EXTRACT_JOB, defaultUrlFetcher, type UrlFetcher, type IntakeDeps } from './intake.js';
export { createOfferForgeHandler, OFFER_FORGE_JOB } from './offerForge.js';
export { createMarketSelectHandler, MARKET_SELECT_JOB } from './marketSelect.js';
export { createMarketProfileHandler, MARKET_PROFILE_JOB } from './marketProfile.js';
export { createVocMineHandler, VOC_MINE_JOB, type VocMineDeps } from './vocMine.js';
