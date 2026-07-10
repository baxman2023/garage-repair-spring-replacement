/**
 * Enum value tuples shared across the schema (and reused by app code).
 * Kept as `as const` string tuples so they can seed `mysqlEnum(...)` and also
 * derive TypeScript unions.
 */

export const WORKSPACE_ROLES = ['owner', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const LICENSE_STATUSES = ['active', 'revoked', 'expired'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_TYPES = ['standard', 'beta'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const API_PROVIDERS = ['anthropic'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const COMPLIANCE_MODES = ['none', 'health', 'finance'] as const;
export type ComplianceMode = (typeof COMPLIANCE_MODES)[number];

export const AWARENESS_STAGES = ['unaware', 'problem', 'solution', 'product', 'most'] as const;
export type AwarenessStage = (typeof AWARENESS_STAGES)[number];

export const VOC_KINDS = ['pain', 'desire', 'objection', 'identity'] as const;
export type VocKind = (typeof VOC_KINDS)[number];

export const GENOME_COMPONENT_TYPES = [
  'lead',
  'mechanism_name',
  'proof_stack',
  'price_reveal',
  'close',
  'bullet_style',
  'headline_pattern',
] as const;
export type GenomeComponentType = (typeof GENOME_COMPONENT_TYPES)[number];

export const ASSET_TYPES = [
  'sales_letter',
  'vsl',
  'short_form_video',
  'webinar',
  'email_sequence',
  'meta_ad',
  'youtube_ad',
  'native_ad',
  'advertorial',
  'upsell',
  'order_bump',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = [
  'draft',
  'council',
  'revising',
  'focus_group',
  'deslop',
  'compliance',
  'packaging',
  'approved',
  'live',
  'retired',
  'blocked',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_VERSION_AUTHORS = ['system', 'user', 'challenger'] as const;
export type AssetVersionAuthor = (typeof ASSET_VERSION_AUTHORS)[number];

export const COUNCIL_LENSES = [
  'schwartz',
  'halbert',
  'bencivenga',
  'sugarman',
  'kennedy',
  'carlton',
] as const;
export type CouncilLens = (typeof COUNCIL_LENSES)[number];

export const COUNCIL_VERDICTS = ['pass', 'revise'] as const;
export type CouncilVerdict = (typeof COUNCIL_VERDICTS)[number];

export const CLAIM_STATUSES = ['proven', 'flagged'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const GATES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;
export type Gate = (typeof GATES)[number];

export const EVENT_TYPES = [
  'page_view',
  'vsl_quartile',
  'quiz_start',
  'quiz_complete',
  'optin',
  'call_start',
  'call_qualified',
  'sale',
  'refund',
  'email_open',
  'email_click',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_SOURCES = ['ringba', 'quiz', 'pixel', 'email', 'manual'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const CHALLENGER_STATUSES = ['queued', 'live', 'won', 'lost'] as const;
export type ChallengerStatus = (typeof CHALLENGER_STATUSES)[number];

export const JOB_STATUSES = ['pending', 'claimed', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const EXPORT_FORMATS = ['markdown', 'html', 'txt', 'zip', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
