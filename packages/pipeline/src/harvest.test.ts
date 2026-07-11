import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  closePool,
  featureFlags,
  getDb,
  getHarvestQuery,
  jobs,
  listSwipes,
  saveHarvestQuery,
  scheduleHarvest,
  subscriptions,
  tenantDb,
  triggerHarvest,
  type ClaimedJob,
} from '@copyforge/db';
import { createHarvestHandler, HarvestBlockedError, GENOME_HARVEST_JOB } from './harvest.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[harvest.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const NOW = new Date('2026-07-01T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function makeJob(workspaceId: string, queryId: string): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: GENOME_HARVEST_JOB,
    payload: { queryId },
    attempts: 1,
    jobRunId: newId(),
  };
}

describe('Ad Library harvester (WO-019)', () => {
  it('persists only ≥90-day ads as swipes with metadata and queues decomposition', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const niche = `harvest-${Date.now()}`;
    const queryId = await saveHarvestQuery({
      workspaceId,
      niche,
      query: { terms: 'garage door springs', country: 'US' },
    });

    const handler = createHarvestHandler({
      now: () => NOW,
      pageIntervalMs: 0,
      fetcher: async ({ page }) =>
        page === 0
          ? [
              { id: 'ad-old', text: 'Winner running long', firstSeen: daysAgo(200), lastSeen: null },
              { id: 'ad-young', text: 'Too new', firstSeen: daysAgo(30), lastSeen: null },
              { id: 'ad-borderline', text: 'Exactly 90', firstSeen: daysAgo(90), lastSeen: null },
            ]
          : [],
    });
    await handler(makeJob(workspaceId, queryId));

    const swipes = (await listSwipes(workspaceId, niche)).filter((s) => s.workspaceId === workspaceId);
    expect(swipes.length).toBe(2); // 200d + 90d kept; 30d filtered
    const old = swipes.find((s) => s.rawSource === 'Winner running long')!;
    expect(old.daysRunning).toBe(200);
    expect(old.channel).toBe('meta');
    expect(old.firstSeen).not.toBeNull();
    expect(old.tags).toContain('adlib:ad-old');

    // Auto-decompose jobs enqueued for each stored swipe.
    const queued = await getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.workspaceId, workspaceId));
    expect(queued.filter((j) => j.type === 'genome.decompose').length).toBe(2);

    const query = await getHarvestQuery(workspaceId, queryId);
    expect((query!.lastResult as { status: string; stored: number }).status).toBe('ok');
    expect((query!.lastResult as { stored: number }).stored).toBe(2);
  });

  it('degrades cleanly to the guided paste flow when the fetch is blocked', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const niche = `blocked-${Date.now()}`;
    const queryId = await saveHarvestQuery({ workspaceId, niche, query: { terms: 'x' } });

    const handler = createHarvestHandler({
      fetcher: async () => {
        throw new HarvestBlockedError('No META_ADLIB_TOKEN configured.');
      },
    });
    await handler(makeJob(workspaceId, queryId)); // does NOT throw — degradation is valid

    const query = await getHarvestQuery(workspaceId, queryId);
    const result = query!.lastResult as { status: string; guidance: string };
    expect(result.status).toBe('degraded');
    expect(result.guidance).toContain('paste');
    expect((await listSwipes(workspaceId, niche)).filter((s) => s.workspaceId === workspaceId)).toEqual([]);
  });

  it('nothing schedules without the Genome Feed entitlement', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const queryId = await saveHarvestQuery({ workspaceId, niche: 'n', query: {} });

    // Platform flag off (seed default) → refused regardless of entitlement.
    await expect(scheduleHarvest(workspaceId, queryId)).rejects.toThrow(/disabled|entitlement/i);

    // Enable the platform flag; still no entitlement → refused.
    await getDb()
      .update(featureFlags)
      .set({ enabled: true })
      .where(eq(featureFlags.key, 'genome_feed_scheduling'));
    try {
      await expect(scheduleHarvest(workspaceId, queryId)).rejects.toThrow(/entitlement/i);

      // Grant the entitlement → schedules.
      await tenantDb(workspaceId).insert(subscriptions, { genomeFeed: true, status: 'active' });
      const jobId = await scheduleHarvest(workspaceId, queryId);
      const row = await getDb().select().from(jobs).where(eq(jobs.id, jobId));
      expect(row[0]?.type).toBe(GENOME_HARVEST_JOB);

      // Manual trigger works regardless of entitlement.
      const manualWs = newId();
      const manualQuery = await saveHarvestQuery({ workspaceId: manualWs, niche: 'm', query: {} });
      await triggerHarvest(manualWs, manualQuery);
    } finally {
      await getDb()
        .update(featureFlags)
        .set({ enabled: false })
        .where(eq(featureFlags.key, 'genome_feed_scheduling'));
    }
  });
});
