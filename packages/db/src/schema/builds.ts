import { index, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';
import { ASSET_TYPES } from './enums';

/**
 * Fan-out orchestration (WO-028): one "Build All" run per project produces an
 * ordered chain of steps — all assets for market 1, then market 2, … — so the
 * §1.2 market/genome cache blocks stay warm. Steps are the durable resume
 * ledger: a killed worker resumes from the first non-done step, never
 * regenerating what already exists.
 */

export const BUILD_STATUSES = ['running', 'done', 'canceled', 'failed'] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const BUILD_STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type BuildStepStatus = (typeof BUILD_STEP_STATUSES)[number];

export const funnelBuilds = mysqlTable(
  'funnel_builds',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id').notNull(),
    status: mysqlEnum('status', BUILD_STATUSES).notNull().default('running'),
    /** The ordered plan as requested (markets × asset types), for display. */
    plan: json('plan').$type<Record<string, unknown>>().notNull(),
    ...timestamps(),
  },
  (t) => [index('funnel_builds_ws_project_idx').on(t.workspaceId, t.projectId)],
);

export const funnelBuildSteps = mysqlTable(
  'funnel_build_steps',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    buildId: ulidRef('build_id').notNull(),
    marketId: ulidRef('market_id').notNull(),
    assetType: mysqlEnum('asset_type', ASSET_TYPES).notNull(),
    seq: int('seq').notNull(),
    status: mysqlEnum('status', BUILD_STEP_STATUSES).notNull().default('pending'),
    jobId: ulidRef('job_id'),
    assetIds: json('asset_ids').$type<string[]>(),
    error: varchar('error', { length: 1024 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('funnel_build_steps_build_seq_uq').on(t.buildId, t.seq),
    index('funnel_build_steps_ws_build_idx').on(t.workspaceId, t.buildId),
  ],
);
