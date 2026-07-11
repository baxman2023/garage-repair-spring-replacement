import { isPermanentApiError, reportError } from '@copyforge/ai';
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  reapStaleJobs,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Worker runtime loop (WO-007): N concurrent claim→process→ack loops plus a
 * stale-claim reaper, with graceful shutdown. Job handlers are registered by
 * type; later work orders supply the real generator/gate handlers.
 */

export type JobHandler = (job: ClaimedJob) => Promise<void>;
export type HandlerRegistry = Record<string, JobHandler>;

export interface WorkerOptions {
  handlers: HandlerRegistry;
  workerId: string;
  concurrency: number;
  pollIntervalMs?: number;
  heartbeatMs?: number;
  staleMs?: number;
  reaperIntervalMs?: number;
}

export interface RunningWorker {
  stop: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function runWorker(opts: WorkerOptions): RunningWorker {
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const heartbeatMs = opts.heartbeatMs ?? 5_000;
  const staleMs = opts.staleMs ?? 30_000;
  const reaperIntervalMs = opts.reaperIntervalMs ?? 15_000;

  let stopped = false;

  async function process(job: ClaimedJob): Promise<void> {
    const beat = setInterval(() => {
      void heartbeatJob(job.id, opts.workerId);
    }, heartbeatMs);
    try {
      const handler = opts.handlers[job.type];
      if (!handler) {
        await failJob(job.id, job.jobRunId, { message: `No handler registered for job type "${job.type}"` });
        return;
      }
      await handler(job);
      await completeJob(job.id, job.jobRunId);
    } catch (err) {
      await failJob(
        job.id,
        job.jobRunId,
        { message: err instanceof Error ? err.message : String(err) },
        { permanent: isPermanentApiError(err) },
      );
      // Redaction-first error reporting (WO-056); never throws.
      await reportError(err, { jobType: job.type, jobId: job.id, attempts: job.attempts });
    } finally {
      clearInterval(beat);
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimNextJob(opts.workerId);
      } catch {
        job = null;
      }
      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }
      await process(job);
    }
  }

  const loops = Array.from({ length: Math.max(1, opts.concurrency) }, () => loop());

  const reaper = setInterval(() => {
    void reapStaleJobs(staleMs);
  }, reaperIntervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(reaper);
      await Promise.all(loops);
    },
  };
}
