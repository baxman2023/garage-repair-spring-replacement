import { index, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';
import { EVENT_SOURCES } from './enums';

/**
 * Event ingestion support (WO-043): the triage queue for unmapped/malformed
 * deliveries (never dropped) and the Ringba campaign→market map.
 */

export const TRIAGE_STATUSES = ['pending', 'resolved', 'discarded'] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const eventTriage = mysqlTable(
  'event_triage',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    source: mysqlEnum('source', EVENT_SOURCES).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    reason: varchar('reason', { length: 512 }).notNull(),
    status: mysqlEnum('status', TRIAGE_STATUSES).notNull().default('pending'),
    ...timestamps(),
  },
  (t) => [index('event_triage_ws_project_status_idx').on(t.workspaceId, t.projectId, t.status)],
);

export const campaignMarketMaps = mysqlTable(
  'campaign_market_maps',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    campaign: varchar('campaign', { length: 255 }).notNull(),
    marketId: ulidRef('market_id').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('campaign_market_maps_project_campaign_uq').on(t.projectId, t.campaign)],
);
