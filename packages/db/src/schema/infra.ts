import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, timestamps, ulidRef } from './_helpers';
import { JOB_STATUSES } from './enums';

/** Infrastructure (spec §3). */

export const jobs = mysqlTable(
  'jobs',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum('status', JOB_STATUSES).notNull().default('pending'),
    priority: int('priority').notNull().default(0),
    runAfter: timestamp('run_after'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    claimedBy: varchar('claimed_by', { length: 64 }),
    heartbeatAt: timestamp('heartbeat_at'),
    lastError: json('last_error').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    // Claim scan: pending jobs ready to run, oldest first.
    index('jobs_status_runafter_idx').on(t.status, t.runAfter),
    // Fair scheduling: pending jobs per workspace.
    index('jobs_ws_status_idx').on(t.workspaceId, t.status),
    // Stale-claim reaper: find claimed jobs with an old heartbeat.
    index('jobs_claimedby_heartbeat_idx').on(t.claimedBy, t.heartbeatAt),
  ],
);

export const jobRuns = mysqlTable(
  'job_runs',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id'),
    jobId: ulidRef('job_id').notNull(),
    attempt: int('attempt').notNull().default(1),
    status: varchar('status', { length: 32 }).notNull(),
    workerId: varchar('worker_id', { length: 64 }),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    error: json('error').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('job_runs_job_idx').on(t.jobId)],
);

export const promptVersions = mysqlTable(
  'prompt_versions',
  {
    id: idColumn(),
    name: varchar('name', { length: 128 }).notNull(),
    version: int('version').notNull().default(1),
    body: text('body').notNull(),
    description: varchar('description', { length: 512 }),
    active: boolean('active').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('prompt_versions_name_version_uq').on(t.name, t.version),
    index('prompt_versions_name_active_idx').on(t.name, t.active),
  ],
);

export const modelRoutes = mysqlTable(
  'model_routes',
  {
    id: idColumn(),
    // NULL workspace_id = platform default; non-NULL = per-workspace override.
    workspaceId: ulidRef('workspace_id'),
    stage: varchar('stage', { length: 64 }).notNull(),
    primaryModel: varchar('primary_model', { length: 128 }).notNull(),
    fallbackChain: json('fallback_chain').$type<string[]>().notNull(),
    maxTokens: int('max_tokens'),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('model_routes_ws_stage_uq').on(t.workspaceId, t.stage)],
);

export const featureFlags = mysqlTable(
  'feature_flags',
  {
    id: idColumn(),
    key: varchar('key', { length: 128 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    description: varchar('description', { length: 512 }),
    value: json('value').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('feature_flags_key_uq').on(t.key)],
);
