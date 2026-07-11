import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  claimNextJob,
  closePool,
  completeJob,
  enqueueJob,
  failJob,
  getDb,
  heartbeatJob,
  jobRuns,
  jobs,
  reapStaleJobs,
  retryDelayMs,
} from './index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[queue.test] MariaDB unreachable — skipping queue tests');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});
beforeEach(async () => {
  if (!dbUp) return;
  await getDb().delete(jobRuns);
  await getDb().delete(jobs);
});

describe('retryDelayMs', () => {
  it('backs off exponentially with a cap', () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(3)).toBe(4_000);
    expect(retryDelayMs(100)).toBe(5 * 60_000);
  });
});

describe('fair scheduler', () => {
  it("does not let one workspace's 100 jobs starve another's 2", async () => {
    if (!dbUp) return;
    const wsA = newId();
    const wsB = newId();
    for (let i = 0; i < 100; i++) await enqueueJob({ workspaceId: wsA, type: 't', payload: { i } });
    for (let i = 0; i < 2; i++) await enqueueJob({ workspaceId: wsB, type: 't', payload: { i } });

    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      const job = await claimNextJob('w1');
      if (!job) break;
      order.push(job.workspaceId);
      await completeJob(job.id, job.jobRunId);
    }

    const bClaims = order.filter((w) => w === wsB);
    expect(bClaims.length).toBe(2); // both of B's jobs served early
    const lastBIndex = order.lastIndexOf(wsB);
    expect(lastBIndex).toBeLessThan(6); // within the first scheduling window
  });
});

describe('atomic claim', () => {
  it('never claims a job twice under concurrent workers', async () => {
    if (!dbUp) return;
    const ws = newId();
    for (let i = 0; i < 8; i++) await enqueueJob({ workspaceId: ws, type: 't', payload: {} });

    // Drain via repeated concurrent bursts, mimicking polling workers. MariaDB
    // applies LIMIT before SKIP LOCKED, so a single burst under contention may
    // return null for some callers — the poll loop retries until drained.
    const claimed: string[] = [];
    for (let round = 0; round < 20 && claimed.length < 8; round++) {
      const batch = await Promise.all(
        Array.from({ length: 4 }, (_v, i) => claimNextJob(`w${i}`).then((j) => j?.id ?? null)),
      );
      for (const id of batch) if (id) claimed.push(id);
    }
    expect(new Set(claimed).size).toBe(claimed.length); // no id claimed twice
    expect(claimed.length).toBe(8); // all 8 eventually claimed
  });
});

describe('retries and backoff', () => {
  it('re-queues with backoff then fails after max attempts', async () => {
    if (!dbUp) return;
    const ws = newId();
    const id = await enqueueJob({ workspaceId: ws, type: 't', payload: {}, maxAttempts: 2 });

    const first = await claimNextJob('w1');
    expect(first?.id).toBe(id);
    const r1 = await failJob(id, first!.jobRunId, { message: 'boom-1' });
    expect(r1.status).toBe('pending');

    let row = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toEqual({ message: 'boom-1' });
    expect(row.runAfter).not.toBeNull(); // scheduled for the future

    // Make it claimable again, exhaust the last attempt.
    await getDb().update(jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(jobs.id, id));
    const second = await claimNextJob('w1');
    expect(second?.id).toBe(id);
    const r2 = await failJob(id, second!.jobRunId, { message: 'boom-2' });
    expect(r2.status).toBe('failed');

    row = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
    expect(row.status).toBe('failed');
    expect(row.lastError).toEqual({ message: 'boom-2' });

    const runs = await getDb().select().from(jobRuns).where(eq(jobRuns.jobId, id));
    expect(runs.length).toBe(2);
    expect(runs.map((r) => r.status).sort()).toEqual(['failed', 'retrying']);
  });
});

describe('heartbeat + stale-claim reaper', () => {
  it('reclaims a crashed job exactly once', async () => {
    if (!dbUp) return;
    const ws = newId();
    const id = await enqueueJob({ workspaceId: ws, type: 't', payload: {} });

    const first = await claimNextJob('w1');
    expect(first?.id).toBe(id);

    // Fresh heartbeat → not reaped.
    expect(await reapStaleJobs(60_000)).toBe(0);
    expect((await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!.status).toBe('claimed');

    // Worker "crashes": heartbeat goes stale.
    await getDb()
      .update(jobs)
      .set({ heartbeatAt: new Date(Date.now() - 120_000) })
      .where(eq(jobs.id, id));
    expect(await reapStaleJobs(60_000)).toBe(1);

    const reaped = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
    expect(reaped.status).toBe('pending');
    expect(reaped.claimedBy).toBeNull();

    // Reclaimed by another worker and completed exactly once.
    const second = await claimNextJob('w2');
    expect(second?.id).toBe(id);
    await completeJob(second!.id, second!.jobRunId);
    expect((await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!.status).toBe('done');
  });

  it('heartbeat only succeeds for the owning worker', async () => {
    if (!dbUp) return;
    const ws = newId();
    await enqueueJob({ workspaceId: ws, type: 't', payload: {} });
    const job = await claimNextJob('owner');
    expect(await heartbeatJob(job!.id, 'owner')).toBe(true);
    expect(await heartbeatJob(job!.id, 'someone-else')).toBe(false);
  });
});
