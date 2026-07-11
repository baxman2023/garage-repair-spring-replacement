import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { and, eq, inArray, ne } from 'drizzle-orm';
// Package SOURCE imports (tsx resolves .js → .ts): the compiled db ESM bundle
// carries a dotenv require shim that plain `node`/tsx cannot execute.
import { newId } from '../../../packages/core/src/index.js';
import {
  closePool,
  enqueueJob,
  getDb,
  jobs,
  resetPausedJobTypesCache,
  setPausedJobTypes,
} from '../../../packages/db/src/index.js';
import { runWorker } from '../src/worker.js';

/**
 * WO-056 load test: 20 concurrent workspace fan-outs through the REAL queue
 * and worker loop. Verifies (a) completion, (b) fair scheduling — every
 * workspace served early and often, no starvation — and (c) zero cross-tenant
 * anomalies: every handler invocation sees exactly the workspace its payload
 * was enqueued under.
 *
 * Pre-existing pending jobs are shielded by pausing their types for the
 * duration (dogfooding the WO-052 kill switch), then unpausing.
 *
 * Run: pnpm tsx scripts/load-test.ts   (from apps/worker)
 */

const WORKSPACES = 20;
const JOBS_PER_WORKSPACE = 40;
const LOAD_TYPE = 'load.fanout';

async function main(): Promise<void> {
  const db = getDb();

  // Shield unrelated pending jobs (test residue, real work) behind the pause switch.
  const pendingTypes = await db
    .selectDistinct({ type: jobs.type })
    .from(jobs)
    .where(and(eq(jobs.status, 'pending'), ne(jobs.type, LOAD_TYPE)));
  const shield = pendingTypes.map((r) => r.type);
  await setPausedJobTypes(shield);
  resetPausedJobTypesCache();
  console.log(`[load] shielding ${shield.length} unrelated pending job type(s):`, shield.join(', ') || '(none)');

  const workspaces = Array.from({ length: WORKSPACES }, () => newId());
  const ids: string[] = [];
  const t0 = Date.now();
  for (const ws of workspaces) {
    for (let i = 0; i < JOBS_PER_WORKSPACE; i++) {
      ids.push(await enqueueJob({ workspaceId: ws, type: LOAD_TYPE, payload: { ws, i } }));
    }
  }
  console.log(`[load] enqueued ${ids.length} jobs across ${WORKSPACES} workspaces in ${Date.now() - t0}ms`);

  // The handler records claim order and cross-checks tenancy.
  const order: Array<{ claimed: string; expected: string }> = [];
  let anomalies = 0;
  const worker = runWorker({
    workerId: 'load-test',
    concurrency: 8,
    pollIntervalMs: 5,
    handlers: {
      [LOAD_TYPE]: async (job) => {
        const expected = String(job.payload.ws);
        order.push({ claimed: job.workspaceId, expected });
        if (job.workspaceId !== expected) anomalies++;
        // Simulate generation work, deterministic per job.
        await new Promise((r) => setTimeout(r, 5 + (Number(job.payload.i) % 10)));
      },
    },
  });

  const t1 = Date.now();
  // Wait until every load job is done (or 5 minutes).
  for (;;) {
    const remaining = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.id, ids), ne(jobs.status, 'done')));
    if (remaining.length === 0) break;
    if (Date.now() - t1 > 300_000) throw new Error(`load test timed out with ${remaining.length} jobs left`);
    await new Promise((r) => setTimeout(r, 250));
  }
  await worker.stop();
  const wallMs = Date.now() - t1;

  // --- Verdicts -------------------------------------------------------------------
  const total = order.length;
  const perWs = new Map<string, number>();
  for (const o of order) perWs.set(o.expected, (perWs.get(o.expected) ?? 0) + 1);

  const firstWindow = order.slice(0, 2 * WORKSPACES);
  const distinctEarly = new Set(firstWindow.map((o) => o.expected)).size;
  const firstServedIndex = new Map<string, number>();
  order.forEach((o, i) => {
    if (!firstServedIndex.has(o.expected)) firstServedIndex.set(o.expected, i);
  });
  const worstFirstService = Math.max(...firstServedIndex.values());

  console.log(`[load] completed ${total} jobs in ${wallMs}ms (${Math.round(total / (wallMs / 1000))} jobs/s)`);
  console.log(`[load] cross-tenant anomalies: ${anomalies}`);
  console.log(`[load] distinct workspaces in first ${2 * WORKSPACES} claims: ${distinctEarly}/${WORKSPACES}`);
  console.log(`[load] worst first-service position: ${worstFirstService} (fair rotation keeps this < ${3 * WORKSPACES})`);
  console.log(
    `[load] per-workspace completions: min ${Math.min(...perWs.values())}, max ${Math.max(...perWs.values())}`,
  );

  const pass =
    total === WORKSPACES * JOBS_PER_WORKSPACE &&
    anomalies === 0 &&
    perWs.size === WORKSPACES &&
    Math.min(...perWs.values()) === JOBS_PER_WORKSPACE &&
    distinctEarly >= WORKSPACES - 1 &&
    worstFirstService < 3 * WORKSPACES;

  // Restore the pause switch and clean up load rows.
  await setPausedJobTypes([]);
  resetPausedJobTypesCache();
  await db.delete(jobs).where(inArray(jobs.id, ids));
  await closePool();

  console.log(pass ? '[load] PASS — fair scheduling intact, zero cross-tenant anomalies' : '[load] FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch(async (err) => {
  console.error('[load] fatal:', err);
  await setPausedJobTypes([]).catch(() => {});
  process.exit(1);
});
