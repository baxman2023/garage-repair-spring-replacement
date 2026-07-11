import {
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_VERSION_AUTHORS,
  CLAIM_STATUSES,
  COUNCIL_LENSES,
  COUNCIL_VERDICTS,
  GATES,
} from './enums';

/** Ordered content block within an asset version (spec §4). */
export interface AssetBlockMeta {
  timestampStart?: number;
  timestampEnd?: number;
  openLoop?: boolean;
  variantOf?: string;
}
export interface AssetBlock {
  id: string;
  role: string;
  text: string;
  meta?: AssetBlockMeta;
}

/** Assets & quality (spec §3). */

export const assets = mysqlTable(
  'assets',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    marketId: ulidRef('market_id'),
    type: mysqlEnum('type', ASSET_TYPES).notNull(),
    status: mysqlEnum('status', ASSET_STATUSES).notNull().default('draft'),
    control: boolean('control').notNull().default(false),
    promptVersionId: ulidRef('prompt_version_id'),
    currentVersionId: ulidRef('current_version_id'),
    // Parent for sibling variants / challengers / feeder→VSL links.
    parentAssetId: ulidRef('parent_asset_id'),
    slug: varchar('slug', { length: 128 }),
    ...timestamps(),
  },
  (t) => [
    index('assets_ws_project_idx').on(t.workspaceId, t.projectId),
    index('assets_ws_market_idx').on(t.workspaceId, t.marketId),
  ],
);

export const assetVersions = mysqlTable(
  'asset_versions',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    assetId: ulidRef('asset_id').notNull(),
    version: int('version').notNull().default(1),
    blocks: json('blocks').$type<AssetBlock[]>().notNull(),
    wordcount: int('wordcount').notNull().default(0),
    readabilityGrade: decimal('readability_grade', { precision: 5, scale: 2 }),
    createdBy: mysqlEnum('created_by', ASSET_VERSION_AUTHORS).notNull().default('system'),
    promptVersionId: ulidRef('prompt_version_id'),
    meta: json('meta').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('asset_versions_asset_version_uq').on(t.assetId, t.version),
    index('asset_versions_ws_asset_idx').on(t.workspaceId, t.assetId),
  ],
);

export const councilReviews = mysqlTable(
  'council_reviews',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    assetVersionId: ulidRef('asset_version_id').notNull(),
    lens: mysqlEnum('lens', COUNCIL_LENSES).notNull(),
    score: int('score').notNull(),
    verdict: mysqlEnum('verdict', COUNCIL_VERDICTS).notNull(),
    notes: json('notes').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('council_reviews_ws_version_idx').on(t.workspaceId, t.assetVersionId)],
);

export const focusGroupRuns = mysqlTable(
  'focus_group_runs',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    assetVersionId: ulidRef('asset_version_id').notNull(),
    annotations: json('annotations').$type<Record<string, unknown>>().notNull(),
    pass: boolean('pass').notNull(),
    report: json('report').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('focus_group_runs_ws_version_idx').on(t.workspaceId, t.assetVersionId)],
);

export const claims = mysqlTable(
  'claims',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    assetId: ulidRef('asset_id').notNull(),
    assetVersionId: ulidRef('asset_version_id'),
    text: text('text').notNull(),
    proofRef: varchar('proof_ref', { length: 255 }),
    status: mysqlEnum('status', CLAIM_STATUSES).notNull().default('flagged'),
    ...timestamps(),
  },
  (t) => [index('claims_ws_asset_idx').on(t.workspaceId, t.assetId)],
);

export const gateReports = mysqlTable(
  'gate_reports',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    // G3–G7 are asset-level; G0–G2 are project-level. Exactly one of
    // asset_id / project_id is set (enforced in the gates store).
    assetId: ulidRef('asset_id'),
    projectId: ulidRef('project_id'),
    gate: mysqlEnum('gate', GATES).notNull(),
    pass: boolean('pass').notNull(),
    report: json('report').$type<Record<string, unknown>>().notNull(),
    overriddenByUserId: ulidRef('overridden_by'),
    overrideReason: text('override_reason'),
    ...timestamps(),
  },
  (t) => [
    index('gate_reports_ws_asset_gate_idx').on(t.workspaceId, t.assetId, t.gate),
    index('gate_reports_ws_project_gate_idx').on(t.workspaceId, t.projectId, t.gate),
  ],
);
