import { and, eq, type SQL, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import {
  apiKeys,
  harvestQueries,
  assetVersions,
  assets,
  challengers,
  claims,
  controls,
  councilReviews,
  events,
  exports,
  focusGroupRuns,
  funnelBuildSteps,
  funnelBuilds,
  funnelMathRuns,
  gateReports,
  licenses,
  markets,
  offers,
  pageBuildPackages,
  predictions,
  productProfiles,
  projects,
  quizAnswers,
  quizDefinitions,
  quizLeads,
  quizSessions,
  seatAssignments,
  subscriptions,
  usageLedger,
  utmVariantMaps,
  vocPhrases,
  vocSources,
} from './schema/index.js';

/**
 * Tenancy guard (spec §2.2 / WO-004).
 *
 * Every tenant-owned table carries a NOT NULL `workspace_id`. Reads and writes
 * to these tables MUST go through {@link tenantDb}, which scopes every query to
 * a single workspace — making cross-tenant access structurally impossible.
 *
 * Bootstrap/identity/infra tables (users, workspaces, workspace_members,
 * sessions, auth_tokens, jobs, model_routes, …) are intentionally NOT in this
 * set: they are accessed while establishing the workspace context, span
 * workspaces (the fair scheduler), or are platform-global config.
 */

type TenantTable = MySqlTable & { workspaceId: MySqlColumn; id: MySqlColumn };

/**
 * Insert payload for a tenant table: everything except `workspace_id`, which
 * the guard stamps itself. (`id` stays optional — ULID default.)
 *
 * NOTE: this is a key-remapped mapped type rather than `Omit<…>` because TS
 * defers `Omit` over `InferInsertModel<T>` in generic positions and then
 * drops the optional properties from excess-property checking, rejecting
 * valid fields at call sites. The homomorphic `as`-remap form resolves
 * correctly at instantiation.
 */
export type TenantInsert<T extends MySqlTable> = {
  [K in keyof InferInsertModel<T> as K extends 'workspaceId' ? never : K]: InferInsertModel<T>[K];
};

/** The tenant business/commerce tables the guard enforces. */
export const TENANT_TABLES = [
  projects,
  productProfiles,
  offers,
  funnelMathRuns,
  markets,
  vocSources,
  vocPhrases,
  assets,
  assetVersions,
  councilReviews,
  focusGroupRuns,
  claims,
  gateReports,
  pageBuildPackages,
  exports,
  quizDefinitions,
  quizSessions,
  quizAnswers,
  quizLeads,
  utmVariantMaps,
  events,
  controls,
  challengers,
  predictions,
  usageLedger,
  apiKeys,
  subscriptions,
  seatAssignments,
  licenses,
  harvestQueries,
  funnelBuilds,
  funnelBuildSteps,
] as const;

/**
 * Drizzle export identifiers of the enforced tables — consumed by the CI
 * tenancy scan (`scripts/tenancy-scan.mjs`). Keep in sync with TENANT_TABLES.
 */
export const TENANT_TABLE_NAMES: readonly string[] = [
  'projects',
  'productProfiles',
  'offers',
  'funnelMathRuns',
  'markets',
  'vocSources',
  'vocPhrases',
  'assets',
  'assetVersions',
  'councilReviews',
  'focusGroupRuns',
  'claims',
  'gateReports',
  'pageBuildPackages',
  'exports',
  'quizDefinitions',
  'quizSessions',
  'quizAnswers',
  'quizLeads',
  'utmVariantMaps',
  'events',
  'controls',
  'challengers',
  'predictions',
  'usageLedger',
  'apiKeys',
  'subscriptions',
  'seatAssignments',
  'licenses',
  'harvestQueries',
  'funnelBuilds',
  'funnelBuildSteps',
];

/**
 * A workspace-scoped query surface. All helpers AND-in
 * `workspace_id = <workspaceId>`; inserts stamp it automatically.
 */
export function tenantDb(workspaceId: string) {
  const db = getDb();

  const scoped = (table: TenantTable, where?: SQL): SQL => {
    const scope = eq(table.workspaceId, workspaceId);
    return where ? (and(scope, where) as SQL) : scope;
  };

  const api = {
    workspaceId,

    findMany: async <T extends TenantTable>(table: T, where?: SQL): Promise<InferSelectModel<T>[]> => {
      return (await db
        .select()
        .from(table as MySqlTable)
        .where(scoped(table, where))) as InferSelectModel<T>[];
    },

    findFirst: async <T extends TenantTable>(
      table: T,
      where?: SQL,
    ): Promise<InferSelectModel<T> | null> => {
      const rows = (await db
        .select()
        .from(table as MySqlTable)
        .where(scoped(table, where))
        .limit(1)) as InferSelectModel<T>[];
      return rows[0] ?? null;
    },

    insert: async <T extends TenantTable>(
      table: T,
      values: TenantInsert<T>,
    ): Promise<string> => {
      const id = (values as { id?: string }).id ?? newId();
      await db.insert(table as any).values({ ...values, id, workspaceId } as any);
      return id;
    },

    update: async <T extends TenantTable>(
      table: T,
      values: Partial<InferInsertModel<T>>,
      where?: SQL,
    ) => {
      return db.update(table as any).set(values as any).where(scoped(table, where));
    },

    delete: async <T extends TenantTable>(table: T, where?: SQL) => {
      return db.delete(table as any).where(scoped(table, where));
    },
  };

  return api;
}

export type TenantDb = ReturnType<typeof tenantDb>;
