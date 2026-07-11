import { assertEnv } from '@copyforge/core';
import { installConsoleRedaction } from '@copyforge/ai';
import { closePool } from '@copyforge/db';
import { runWorker, type HandlerRegistry } from './worker.js';
import {
  createIntakeHandler,
  createMarketProfileHandler,
  createMarketSelectHandler,
  createOfferForgeHandler,
  createVocMineHandler,
  INTAKE_EXTRACT_JOB,
  MARKET_PROFILE_JOB,
  MARKET_SELECT_JOB,
  OFFER_FORGE_JOB,
  VOC_MINE_JOB,
} from '@copyforge/pipeline';

/**
 * CopyForge worker entrypoint. Validates the environment, installs secret
 * redaction, and runs the job-claim loop with graceful shutdown.
 *
 * Handlers for concrete job types (generators, gates, harvesters, ledger jobs)
 * are registered here as later work orders land them.
 */

const handlers: HandlerRegistry = {
  [INTAKE_EXTRACT_JOB]: createIntakeHandler(),
  [OFFER_FORGE_JOB]: createOfferForgeHandler(),
  [MARKET_SELECT_JOB]: createMarketSelectHandler(),
  [MARKET_PROFILE_JOB]: createMarketProfileHandler(),
  [VOC_MINE_JOB]: createVocMineHandler(),
};

let shuttingDown = false;

async function main(): Promise<void> {
  installConsoleRedaction();
  const env = assertEnv();
  const workerId = `worker-${process.pid}`;
  console.log(
    `[worker] started ${workerId} (env=${env.NODE_ENV}, concurrency=${env.WORKER_CONCURRENCY})`,
  );

  const worker = runWorker({
    handlers,
    workerId,
    concurrency: env.WORKER_CONCURRENCY,
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] received ${signal}, draining…`);
    void worker
      .stop()
      .then(() => closePool())
      .then(() => {
        console.log('[worker] shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        console.error('[worker] error during shutdown', err);
        process.exit(1);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[worker] fatal error during startup', err);
  process.exit(1);
});
