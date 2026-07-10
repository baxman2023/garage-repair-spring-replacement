import {
  boolean,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, timestamps, ulidRef } from './_helpers';
import { AWARENESS_STAGES, VOC_KINDS } from './enums';

/** Strategy phase (spec §3). All tables tenant-scoped by `workspace_id`. */

export const projects = mysqlTable(
  'projects',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    // Coarse pipeline position: intake | strategy | build | live (advisory).
    status: varchar('status', { length: 32 }).notNull().default('intake'),
    currentProfileId: ulidRef('current_profile_id'),
    currentOfferId: ulidRef('current_offer_id'),
    createdByUserId: ulidRef('created_by_user_id'),
    ...timestamps(),
  },
  (t) => [index('projects_ws_created_idx').on(t.workspaceId, t.createdAt)],
);

export const productProfiles = mysqlTable(
  'product_profiles',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    version: int('version').notNull().default(1),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull().default('1'),
    profile: json('profile').$type<Record<string, unknown>>().notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    createdByUserId: ulidRef('created_by_user_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('product_profiles_project_version_uq').on(t.projectId, t.version),
    index('product_profiles_ws_project_idx').on(t.workspaceId, t.projectId),
  ],
);

export const offers = mysqlTable(
  'offers',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    version: int('version').notNull().default(1),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull().default('1'),
    offer: json('offer').$type<Record<string, unknown>>().notNull(),
    // G0 approval state.
    approved: boolean('approved').notNull().default(false),
    selected: boolean('selected').notNull().default(false),
    createdByUserId: ulidRef('created_by_user_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('offers_project_version_uq').on(t.projectId, t.version),
    index('offers_ws_project_idx').on(t.workspaceId, t.projectId),
  ],
);

export const funnelMathRuns = mysqlTable(
  'funnel_math_runs',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    inputs: json('inputs').$type<Record<string, unknown>>().notNull(),
    outputs: json('outputs').$type<Record<string, unknown>>().notNull(),
    // G1 pass/fail (hard stop when false).
    pass: boolean('pass').notNull(),
    report: json('report').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('funnel_math_runs_ws_project_idx').on(t.workspaceId, t.projectId)],
);

export const markets = mysqlTable(
  'markets',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    rank: tinyint('rank').notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull().default('1'),
    profile: json('profile').$type<Record<string, unknown>>().notNull(),
    awarenessStage: mysqlEnum('awareness_stage', AWARENESS_STAGES),
    sophistication: tinyint('sophistication'),
    residentEmotion: varchar('resident_emotion', { length: 255 }),
    scoreTotal: decimal('score_total', { precision: 8, scale: 3 }),
    rationale: text('rationale'),
    ...timestamps(),
  },
  (t) => [index('markets_ws_project_idx').on(t.workspaceId, t.projectId)],
);

export const vocSources = mysqlTable(
  'voc_sources',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    marketId: ulidRef('market_id'),
    // 'paste' | 'url'
    kind: varchar('kind', { length: 16 }).notNull(),
    ref: text('ref'),
    rawContent: text('raw_content'),
    fetchedAt: timestamp('fetched_at'),
    ...timestamps(),
  },
  (t) => [index('voc_sources_ws_project_idx').on(t.workspaceId, t.projectId)],
);

export const vocPhrases = mysqlTable(
  'voc_phrases',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    marketId: ulidRef('market_id').notNull(),
    phrase: text('phrase').notNull(),
    kind: mysqlEnum('kind', VOC_KINDS).notNull(),
    sourceRef: ulidRef('source_ref'),
    ...timestamps(),
  },
  (t) => [index('voc_phrases_ws_market_idx').on(t.workspaceId, t.marketId)],
);
