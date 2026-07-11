import { assertEnv } from '@copyforge/core';
import { installConsoleRedaction } from '@copyforge/ai';

/**
 * CopyForge worker entrypoint.
 *
 * Responsibilities beyond this bootstrap — the atomic job-claim loop
 * (`FOR UPDATE SKIP LOCKED`), round-robin fair scheduling, heartbeats, the
 * stale-claim reaper, and the generators/gates — are delivered in WO-007 and
 * later. This file is the real process runtime: it validates the environment,
 * installs graceful-shutdown handlers, and keeps the process supervised.
 */

let shuttingDown = false;
let keepAlive: NodeJS.Timeout | null = null;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, shutting down`);
  if (keepAlive) clearInterval(keepAlive);
  process.exit(0);
}

async function main(): Promise<void> {
  installConsoleRedaction();
  const env = assertEnv();
  console.log(
    `[worker] started (env=${env.NODE_ENV}, concurrency=${env.WORKER_CONCURRENCY})`,
  );

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process supervised and the event loop alive. The atomic
  // job-claim loop (WO-007) replaces this idle heartbeat with real work.
  keepAlive = setInterval(() => {
    /* idle until the job-claim loop is installed in WO-007 */
  }, 30_000);
}

main().catch((err) => {
  console.error('[worker] fatal error during startup', err);
  process.exit(1);
});
