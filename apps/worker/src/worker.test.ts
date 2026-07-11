import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { closePool, enqueueJob, getDb, jobs } from '@copyforge/db';
import { runWorker, type HandlerRegistry } from './worker.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[worker.test] MariaDB unreachable — skipping worker loop tests');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});
beforeEach(async () => {
  if (dbUp) await getDb().delete(jobs);
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('worker loop', () => {
  it('dispatches jobs to handlers and marks them done (concurrency 2)', async () => {
    if (!dbUp) return;
    const ws = newId();
    const processed: string[] = [];
    const handlers: HandlerRegistry = {
      'test.echo': async (job) => {
        processed.push(job.payload.tag as string);
      },
    };
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(await enqueueJob({ workspaceId: ws, type: 'test.echo', payload: { tag: `t${i}` } }));
    }

    const worker = runWorker({ handlers, workerId: 'wtest', concurrency: 2, pollIntervalMs: 20 });
    const allDone = await waitFor(async () => {
      const rows = await getDb().select({ status: jobs.status }).from(jobs).where(inArray(jobs.id, ids));
      return rows.length === 6 && rows.every((r) => r.status === 'done');
    });
    await worker.stop();

    expect(allDone).toBe(true);
    expect(processed.sort()).toEqual(['t0', 't1', 't2', 't3', 't4', 't5']);
  });

  it('fails a job whose handler throws, recording the error', async () => {
    if (!dbUp) return;
    const ws = newId();
    const handlers: HandlerRegistry = {
      'test.boom': async () => {
        throw new Error('handler exploded');
      },
    };
    const id = await enqueueJob({ workspaceId: ws, type: 'test.boom', payload: {}, maxAttempts: 1 });

    const worker = runWorker({ handlers, workerId: 'wtest', concurrency: 1, pollIntervalMs: 20 });
    const failed = await waitFor(async () => {
      const row = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0];
      return row?.status === 'failed';
    });
    await worker.stop();

    expect(failed).toBe(true);
    const row = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
    expect(row.lastError).toEqual({ message: 'handler exploded' });
  });

  it('fails jobs with no registered handler', async () => {
    if (!dbUp) return;
    const ws = newId();
    const id = await enqueueJob({ workspaceId: ws, type: 'unknown.type', payload: {}, maxAttempts: 1 });
    const worker = runWorker({ handlers: {}, workerId: 'wtest', concurrency: 1, pollIntervalMs: 20 });
    const failed = await waitFor(async () => {
      const row = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0];
      return row?.status === 'failed';
    });
    await worker.stop();
    expect(failed).toBe(true);
    const row = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
    expect(String((row.lastError as { message: string }).message)).toContain('No handler');
  });
});
