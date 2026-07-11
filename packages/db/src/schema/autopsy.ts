import { index, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';

/**
 * Autopsy Mode (WO-047): funnel teardowns. `share_token` (nullable) is the
 * ONLY public handle — revoking sets it null and the report goes dark.
 */

export const AUTOPSY_STATUSES = ['draft', 'queued', 'analyzing', 'complete', 'failed'] as const;
export type AutopsyStatus = (typeof AUTOPSY_STATUSES)[number];

export const autopsies = mysqlTable(
  'autopsies',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    status: mysqlEnum('status', AUTOPSY_STATUSES).notNull().default('draft'),
    // [{kind, sourceUrl?, content?}] — content filled in by the fetch step.
    pages: json('pages').$type<Array<Record<string, unknown>>>().notNull(),
    report: json('report').$type<Record<string, unknown>>(),
    error: varchar('error', { length: 512 }),
    shareToken: varchar('share_token', { length: 64 }),
    // Set by the "rebuild in CopyForge" handoff.
    rebuiltProjectId: ulidRef('rebuilt_project_id'),
    ...timestamps(),
  },
  (t) => [
    index('autopsies_ws_idx').on(t.workspaceId),
    uniqueIndex('autopsies_share_token_uq').on(t.shareToken),
  ],
);
