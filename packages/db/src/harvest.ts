import { eq } from 'drizzle-orm';
import { JOB_TYPES } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { enqueueJob } from './queue.js';
import { featureFlags, harvestQueries, subscriptions } from './schema/index.js';

/**
 * Harvester queries + scheduling gate (WO-019). Manual triggers are always
 * allowed; SCHEDULED runs require the Genome Feed entitlement (workspace
 * subscription) AND the platform `genome_feed_scheduling` flag.
 */

export type HarvestQueryRow = typeof harvestQueries.$inferSelect;

export async function saveHarvestQuery(params: {
  workspaceId: string;
  niche: string;
  query: Record<string, unknown>;
}): Promise<string> {
  return tenantDb(params.workspaceId).insert(harvestQueries, {
    niche: params.niche,
    query: params.query,
  });
}

export async function listHarvestQueries(workspaceId: string): Promise<HarvestQueryRow[]> {
  return tenantDb(workspaceId).findMany(harvestQueries, undefined);
}

export async function getHarvestQuery(
  workspaceId: string,
  queryId: string,
): Promise<HarvestQueryRow | null> {
  return tenantDb(workspaceId).findFirst(harvestQueries, eq(harvestQueries.id, queryId));
}

export async function recordHarvestResult(params: {
  workspaceId: string;
  queryId: string;
  result: Record<string, unknown>;
}): Promise<void> {
  await tenantDb(params.workspaceId).update(
    harvestQueries,
    { lastRunAt: new Date(), lastResult: params.result },
    eq(harvestQueries.id, params.queryId),
  );
}

/** Manual trigger — always allowed. */
export async function triggerHarvest(workspaceId: string, queryId: string): Promise<string> {
  const query = await getHarvestQuery(workspaceId, queryId);
  if (!query) throw new Error('Harvest query not found.');
  return enqueueJob({
    workspaceId,
    type: JOB_TYPES.genomeHarvest,
    payload: { queryId },
  });
}

/** True when the workspace holds the Genome Feed entitlement. */
export async function hasGenomeFeedEntitlement(workspaceId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ genomeFeed: subscriptions.genomeFeed, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId));
  return rows.some((r) => r.genomeFeed && r.status === 'active');
}

/**
 * Scheduled trigger (Genome Feed / WO-051 nightly): refuses without the
 * entitlement AND the platform scheduling flag. Nothing schedules without
 * entitlement — the WO-019 acceptance.
 */
export async function scheduleHarvest(workspaceId: string, queryId: string): Promise<string> {
  const flag = await getDb()
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(eq(featureFlags.key, 'genome_feed_scheduling'))
    .limit(1);
  if (!flag[0]?.enabled) {
    throw new Error('Scheduled harvesting is disabled platform-wide (genome_feed_scheduling).');
  }
  if (!(await hasGenomeFeedEntitlement(workspaceId))) {
    throw new Error('Genome Feed entitlement required to schedule harvest runs.');
  }
  return triggerHarvest(workspaceId, queryId);
}
