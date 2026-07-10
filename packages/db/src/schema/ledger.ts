import {
  decimal,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, timestamps, ulidRef } from './_helpers';
import { ASSET_TYPES, CHALLENGER_STATUSES, EVENT_SOURCES, EVENT_TYPES } from './enums';

/** Control Ledger (spec §3 / Phase 5). */

export const events = mysqlTable(
  'events',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id'),
    marketId: ulidRef('market_id'),
    assetId: ulidRef('asset_id'),
    type: mysqlEnum('type', EVENT_TYPES).notNull(),
    value: json('value').$type<Record<string, unknown>>(),
    sessionRef: varchar('session_ref', { length: 64 }),
    source: mysqlEnum('source', EVENT_SOURCES).notNull(),
    occurredAt: timestamp('occurred_at').notNull().defaultNow(),
    dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
    ...timestamps(),
  },
  (t) => [
    // Tenant-scoped dedupe: replay-safe ingestion within a workspace.
    uniqueIndex('events_ws_dedupe_uq').on(t.workspaceId, t.dedupeKey),
    index('events_ws_project_occurred_idx').on(t.workspaceId, t.projectId, t.occurredAt),
    index('events_ws_market_idx').on(t.workspaceId, t.marketId),
  ],
);

export const controls = mysqlTable(
  'controls',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    marketId: ulidRef('market_id').notNull(),
    assetType: mysqlEnum('asset_type', ASSET_TYPES).notNull(),
    assetId: ulidRef('asset_id').notNull(),
    since: timestamp('since').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('controls_project_market_type_uq').on(t.projectId, t.marketId, t.assetType),
    index('controls_ws_idx').on(t.workspaceId),
  ],
);

export const challengers = mysqlTable(
  'challengers',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    controlId: ulidRef('control_id').notNull(),
    assetId: ulidRef('asset_id').notNull(),
    status: mysqlEnum('status', CHALLENGER_STATUSES).notNull().default('queued'),
    ...timestamps(),
  },
  (t) => [index('challengers_ws_control_idx').on(t.workspaceId, t.controlId)],
);

export const predictions = mysqlTable(
  'predictions',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    assetId: ulidRef('asset_id').notNull(),
    metric: varchar('metric', { length: 64 }).notNull(),
    predicted: decimal('predicted', { precision: 8, scale: 6 }).notNull(),
    actual: decimal('actual', { precision: 8, scale: 6 }),
    brier: decimal('brier', { precision: 8, scale: 6 }),
    band: json('band').$type<Record<string, unknown>>(),
    resolvedAt: timestamp('resolved_at'),
    ...timestamps(),
  },
  (t) => [index('predictions_ws_asset_idx').on(t.workspaceId, t.assetId)],
);

export const calibrationState = mysqlTable(
  'calibration_state',
  {
    id: idColumn(),
    // NULL workspace_id = platform default calibration; non-NULL = per-workspace.
    workspaceId: ulidRef('workspace_id'),
    adjustments: json('adjustments').$type<Record<string, unknown>>().notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('calibration_state_ws_uq').on(t.workspaceId)],
);
