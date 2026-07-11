import {
  boolean,
  index,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';
import { EXPORT_FORMATS } from './enums';

/** Delivery & runtime (spec §3). */

export const pageBuildPackages = mysqlTable(
  'page_build_packages',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id'),
    marketId: ulidRef('market_id'),
    assetId: ulidRef('asset_id'),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull().default('1'),
    package: json('package').$type<Record<string, unknown>>().notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    ...timestamps(),
  },
  (t) => [index('page_build_packages_ws_asset_idx').on(t.workspaceId, t.assetId)],
);

export const exports = mysqlTable(
  'exports',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    packageId: ulidRef('package_id'),
    assetId: ulidRef('asset_id'),
    marketId: ulidRef('market_id'),
    format: mysqlEnum('format', EXPORT_FORMATS).notNull(),
    path: varchar('path', { length: 1024 }).notNull(),
    checksum: varchar('checksum', { length: 64 }),
    manifest: json('manifest').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('exports_ws_idx').on(t.workspaceId)],
);

export const quizDefinitions = mysqlTable(
  'quiz_definitions',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    questions: json('questions').$type<Record<string, unknown>[]>().notNull(),
    scoring: json('scoring').$type<Record<string, unknown>>().notNull(),
    bands: json('bands').$type<Record<string, unknown>[]>().notNull(),
    webhookUrl: varchar('webhook_url', { length: 1024 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('quiz_definitions_slug_uq').on(t.slug),
    index('quiz_definitions_ws_project_idx').on(t.workspaceId, t.projectId),
  ],
);

export const quizSessions = mysqlTable(
  'quiz_sessions',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    quizDefinitionId: ulidRef('quiz_definition_id').notNull(),
    sessionRef: varchar('session_ref', { length: 64 }).notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    meta: json('meta').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    index('quiz_sessions_ws_def_idx').on(t.workspaceId, t.quizDefinitionId),
    uniqueIndex('quiz_sessions_ref_uq').on(t.sessionRef),
  ],
);

export const quizAnswers = mysqlTable(
  'quiz_answers',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    sessionId: ulidRef('session_id').notNull(),
    questionId: varchar('question_id', { length: 64 }).notNull(),
    answer: json('answer').$type<Record<string, unknown>>().notNull(),
    ...timestamps(),
  },
  (t) => [index('quiz_answers_session_idx').on(t.sessionId)],
);

export const quizLeads = mysqlTable(
  'quiz_leads',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    sessionId: ulidRef('session_id'),
    quizDefinitionId: ulidRef('quiz_definition_id'),
    band: varchar('band', { length: 64 }),
    marketId: ulidRef('market_id'),
    contact: json('contact').$type<Record<string, unknown>>(),
    disqualified: boolean('disqualified').notNull().default(false),
    ...timestamps(),
  },
  (t) => [index('quiz_leads_ws_idx').on(t.workspaceId)],
);

export const utmVariantMaps = mysqlTable(
  'utm_variant_maps',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id'),
    assetId: ulidRef('asset_id'),
    utmContent: varchar('utm_content', { length: 255 }),
    utmCampaign: varchar('utm_campaign', { length: 255 }),
    headlineVariant: json('headline_variant').$type<Record<string, unknown>>(),
    leadVariant: json('lead_variant').$type<Record<string, unknown>>(),
    variantOfAssetId: ulidRef('variant_of_asset_id'),
    ...timestamps(),
  },
  (t) => [index('utm_variant_maps_ws_idx').on(t.workspaceId)],
);
