import {
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';
import { AWARENESS_STAGES, GENOME_COMPONENT_TYPES } from './enums';

/**
 * Persuasion Genome (spec §3 / WO-017-019, WO-048).
 *
 * `workspace_id` is NULLABLE here: NULL rows are the shared seed corpus
 * (owner-provided + harvested), non-NULL rows are a workspace-private layer of
 * internal winners that must never leak across workspaces (WO-048).
 */

export const swipes = mysqlTable(
  'swipes',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id'),
    rawSource: text('raw_source').notNull(),
    niche: varchar('niche', { length: 128 }),
    channel: varchar('channel', { length: 64 }),
    firstSeen: timestamp('first_seen'),
    lastSeen: timestamp('last_seen'),
    daysRunning: int('days_running'),
    tags: json('tags').$type<string[]>(),
    ...timestamps(),
  },
  (t) => [
    index('swipes_ws_idx').on(t.workspaceId),
    index('swipes_niche_idx').on(t.niche),
  ],
);

export const genomeComponents = mysqlTable(
  'genome_components',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id'),
    swipeId: ulidRef('swipe_id').notNull(),
    type: mysqlEnum('type', GENOME_COMPONENT_TYPES).notNull(),
    content: json('content').$type<Record<string, unknown>>().notNull(),
    tags: json('tags').$type<string[]>(),
    confidence: decimal('confidence', { precision: 5, scale: 4 }),
    niche: varchar('niche', { length: 128 }),
    channel: varchar('channel', { length: 64 }),
    awareness: mysqlEnum('awareness', AWARENESS_STAGES),
    isInternalWinner: boolean('is_internal_winner').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index('genome_components_type_niche_idx').on(t.type, t.niche),
    index('genome_components_ws_idx').on(t.workspaceId),
    index('genome_components_swipe_idx').on(t.swipeId),
  ],
);

export const genomePacks = mysqlTable(
  'genome_packs',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id'),
    niche: varchar('niche', { length: 128 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    // Curated retrieval set: ordered component ids + retrieval filters.
    definition: json('definition').$type<Record<string, unknown>>().notNull(),
    ...timestamps(),
  },
  (t) => [index('genome_packs_niche_idx').on(t.niche)],
);

export const harvestQueries = mysqlTable(
  'harvest_queries',
  {
    id: idColumn(),
    // Tenant-scoped: each workspace curates its own niche queries (WO-019).
    workspaceId: ulidRef('workspace_id').notNull(),
    niche: varchar('niche', { length: 128 }).notNull(),
    query: json('query').$type<Record<string, unknown>>().notNull(),
    lastRunAt: timestamp('last_run_at'),
    lastResult: json('last_result').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('harvest_queries_ws_idx').on(t.workspaceId, t.niche)],
);
