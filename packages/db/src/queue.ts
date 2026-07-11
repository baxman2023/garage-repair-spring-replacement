import { and, asc, desc, eq, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { env, newId } from '@copyforge/core';
import { getDb } from './client.js';
import { jobRuns, jobs } from './schema/index.js';

/**
 * Durable, multi-tenant job queue with fair scheduling (WO-007).
 *
 * - Atomic claim via `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction.
 * - Fairness: claim the oldest ready job of the least-recently-served
 *   workspace (never-served workspaces first), so one tenant's fan-out can't
 *   starve another (spec §2.2).
 * - Heartbeats + a stale-claim reaper make crashes recoverable exactly once.
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 5 * 60_000;

/** Exponential backoff for a retry after `attempts` failures (pure). */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_CAP_MS);
}

/** Normalize a drizzle `.execute()` result to its rows array (mysql2 tuple). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Array<Record<string, unknown>>;
  }
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return [];
}

export interface EnqueueParams {
  workspaceId: string;
  type: string;
  payload: Record<string, unknown>;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
}

export async function enqueueJob(params: EnqueueParams): Promise<string> {
  // Per-workspace backlog cap (WO-056): a runaway enqueuer cannot flood the
  // queue past JOB_ENQUEUE_CAP pending jobs. Fairness protects other tenants
  // from slow service; this protects the table itself.
  const cap = env.JOB_ENQUEUE_CAP;
  const [pending] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, params.workspaceId), eq(jobs.status, 'pending')));
  if (Number(pending?.n ?? 0) >= cap) {
    throw new Error(
      `Job enqueue cap reached: this workspace already has ${cap} pending jobs. ` +
        'Let the queue drain (or cancel stale work) before enqueueing more.',
    );
  }

  const id = newId();
  await getDb()
    .insert(jobs)
    .values({
      id,
      workspaceId: params.workspaceId,
      type: params.type,
      payload: params.payload,
      status: 'pending',
      priority: params.priority ?? 0,
      runAfter: params.runAfter ?? null,
      maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      attempts: 0,
    });
  return id;
}

export interface ClaimedJob {
  id: string;
  workspaceId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  jobRunId: string;
}

/**
 * Atomically claim the next job for `workerId`, honoring fairness. Returns null
 * when nothing is ready (or everything ready is locked by other workers).
 */
export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const db = getDb();
  // Kill switches (WO-052): paused types are invisible to the claim loop.
  // Cached (5s), so a flag flip takes effect without a deploy or restart.
  const { pausedJobTypesCached } = await import('./flagsStore.js');
  const paused = await pausedJobTypesCached();
  const pausedFilter =
    paused.length > 0
      ? sql` AND j.type NOT IN (${sql.join(paused.map((t) => sql`${t}`), sql`, `)})`
      : sql``;

  return db.transaction(async (tx) => {
    // 1. Least-recently-served workspace with a ready pending job.
    //    NULL last_served (never served) sorts first.
    const wsResult = await tx.execute(sql`
      SELECT j.workspace_id AS workspaceId
      FROM jobs j
      LEFT JOIN (
        SELECT workspace_id, MAX(heartbeat_at) AS last_served
        FROM jobs GROUP BY workspace_id
      ) s ON s.workspace_id = j.workspace_id
      WHERE j.status = 'pending' AND (j.run_after IS NULL OR j.run_after <= NOW())${pausedFilter}
      GROUP BY j.workspace_id, s.last_served
      ORDER BY (s.last_served IS NOT NULL) ASC, s.last_served ASC, MIN(j.created_at) ASC
      LIMIT 1
    `);
    const workspaceId = rowsOf(wsResult)[0]?.workspaceId as string | undefined;
    if (!workspaceId) return null;

    // 2. Claim that workspace's oldest ready job, skipping locked rows.
    const claim = await tx
      .select({
        id: jobs.id,
        type: jobs.type,
        payload: jobs.payload,
        attempts: jobs.attempts,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, workspaceId),
          eq(jobs.status, 'pending'),
          or(isNull(jobs.runAfter), lte(jobs.runAfter, new Date())),
          ...(paused.length > 0 ? [notInArray(jobs.type, paused)] : []),
        ),
      )
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const job = claim[0];
    if (!job) return null;

    const attempts = job.attempts + 1;
    await tx
      .update(jobs)
      .set({ status: 'claimed', claimedBy: workerId, heartbeatAt: new Date(), attempts })
      .where(eq(jobs.id, job.id));

    const jobRunId = newId();
    await tx.insert(jobRuns).values({
      id: jobRunId,
      workspaceId,
      jobId: job.id,
      attempt: attempts,
      status: 'running',
      workerId,
    });

    return {
      id: job.id,
      workspaceId,
      type: job.type,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      attempts,
      jobRunId,
    };
  });
}

/** Refresh a claimed job's heartbeat. Returns false if it's no longer ours. */
export async function heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
  const res = await getDb()
    .update(jobs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.claimedBy, workerId), eq(jobs.status, 'claimed')));
  return res[0].affectedRows > 0;
}

/** Mark a job done and close its running audit row. */
export async function completeJob(jobId: string, jobRunId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(jobs).set({ status: 'done' }).where(eq(jobs.id, jobId));
    await tx
      .update(jobRuns)
      .set({ status: 'succeeded', finishedAt: new Date() })
      .where(eq(jobRuns.id, jobRunId));
  });
}

export interface JobError {
  message: string;
  [key: string]: unknown;
}

/**
 * Fail an attempt. Re-queues with backoff until `max_attempts`, then marks the
 * job `failed` with the error recorded as JSON.
 */
export async function failJob(
  jobId: string,
  jobRunId: string,
  error: JobError,
  opts?: { permanent?: boolean },
): Promise<{ status: 'pending' | 'failed' }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    const job = rows[0];
    // Permanent failures (e.g. 401 bad API key) skip the retry ladder —
    // retrying cannot succeed and only delays the user's feedback.
    const exhausted = opts?.permanent || !job || job.attempts >= job.maxAttempts;

    if (exhausted) {
      await tx.update(jobs).set({ status: 'failed', lastError: error }).where(eq(jobs.id, jobId));
    } else {
      await tx
        .update(jobs)
        .set({
          status: 'pending',
          claimedBy: null,
          heartbeatAt: null,
          runAfter: new Date(Date.now() + retryDelayMs(job.attempts)),
          lastError: error,
        })
        .where(eq(jobs.id, jobId));
    }

    await tx
      .update(jobRuns)
      .set({ status: exhausted ? 'failed' : 'retrying', finishedAt: new Date(), error })
      .where(eq(jobRuns.id, jobRunId));

    return { status: exhausted ? ('failed' as const) : ('pending' as const) };
  });
}

/**
 * Reclaim jobs whose worker died (stale heartbeat): re-queue them (or fail if
 * out of attempts). Returns the number reaped. Ensures a crashed job is
 * reprocessed exactly once rather than lost or double-run.
 */
export async function reapStaleJobs(staleMs: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - staleMs);
  const stale = await db
    .select({ id: jobs.id, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
    .from(jobs)
    .where(and(eq(jobs.status, 'claimed'), lt(jobs.heartbeatAt, cutoff)));

  for (const job of stale) {
    const exhausted = job.attempts >= job.maxAttempts;
    await db
      .update(jobs)
      .set(
        exhausted
          ? { status: 'failed', lastError: { message: 'stale claim reaped: attempts exhausted' } }
          : { status: 'pending', claimedBy: null, heartbeatAt: null },
      )
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'claimed')));
    await db
      .update(jobRuns)
      .set({ status: 'reaped', finishedAt: new Date() })
      .where(and(eq(jobRuns.jobId, job.id), eq(jobRuns.status, 'running')));
  }
  return stale.length;
}

/**
 * Latest job of a type for a project (WO-056 UX fix): lets the UI show a
 * queued/extracting/failed state instead of waiting forever on a job that
 * died. Payloads carry `projectId`, so the match is on the JSON column.
 */
export async function latestJobForProject(
  workspaceId: string,
  type: string,
  projectId: string,
): Promise<{ id: string; status: string; error: string | null; createdAt: Date } | null> {
  const rows = await getDb()
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.type, type),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.payload}, '$.projectId')) = ${projectId}`,
      ),
    )
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    error: (row.lastError as { message?: string } | null)?.message ?? null,
    createdAt: row.createdAt,
  };
}
