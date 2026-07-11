import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Load the repo-root .env before anything reads `env` (dev/staging; PM2 prod
// environments inject real vars and dotenv never overrides them).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { assertEnv } from '@copyforge/core';
import { getDb } from '@copyforge/db';
import { installConsoleRedaction } from '@copyforge/ai';
import { closePool, enqueueDueNightlyLearning, reapLapsedSubscriptions } from '@copyforge/db';
import { runWorker, type HandlerRegistry } from './worker.js';
import {
  createIntakeHandler,
  createMarketProfileHandler,
  createMarketSelectHandler,
  createOfferForgeHandler,
  createGenomeDecomposeHandler,
  createHarvestHandler,
  createRegenBlockHandler,
  createGenerateHandler,
  createBuildStepHandler,
  createCouncilJobHandler,
  createFocusGroupHandler,
  createFocusFixHandler,
  createDeslopHandler,
  createComplianceHandler,
  createPackageHandler,
  createQuizGenerateHandler,
  createVocMineHandler,
  createWebhookHandler,
  createChallengerGenerateHandler,
  createPredictionsResolveHandler,
  createCalibrationRunHandler,
  createAutopsyRunHandler,
  AUTOPSY_RUN_JOB,
  createLearningNightlyHandler,
  LEARNING_NIGHTLY_JOB,
  ASSET_COMPLIANCE_JOB,
  CALIBRATION_RUN_JOB,
  CHALLENGER_GENERATE_JOB,
  PREDICTIONS_RESOLVE_JOB,
  ASSET_PACKAGE_JOB,
  QUIZ_GENERATE_JOB,
  WEBHOOK_DELIVER_JOB,
  ASSET_DESLOP_JOB,
  ASSET_FOCUS_GROUP_JOB,
  ASSET_FOCUS_FIX_JOB,
  BUILD_STEP_JOB,
  GENOME_DECOMPOSE_JOB,
  GENOME_HARVEST_JOB,
  ASSET_REGEN_BLOCK_JOB,
  ASSET_GENERATE_JOB,
  ASSET_COUNCIL_JOB,
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
  [GENOME_DECOMPOSE_JOB]: createGenomeDecomposeHandler(),
  [GENOME_HARVEST_JOB]: createHarvestHandler(),
  [ASSET_REGEN_BLOCK_JOB]: createRegenBlockHandler(),
  [ASSET_GENERATE_JOB]: createGenerateHandler(),
  [BUILD_STEP_JOB]: createBuildStepHandler(),
  [ASSET_COUNCIL_JOB]: createCouncilJobHandler(),
  [ASSET_FOCUS_GROUP_JOB]: createFocusGroupHandler(),
  [ASSET_FOCUS_FIX_JOB]: createFocusFixHandler(),
  [ASSET_DESLOP_JOB]: createDeslopHandler(),
  [ASSET_COMPLIANCE_JOB]: createComplianceHandler(),
  [ASSET_PACKAGE_JOB]: createPackageHandler(),
  [QUIZ_GENERATE_JOB]: createQuizGenerateHandler(),
  [WEBHOOK_DELIVER_JOB]: createWebhookHandler(),
  [CHALLENGER_GENERATE_JOB]: createChallengerGenerateHandler(),
  [PREDICTIONS_RESOLVE_JOB]: createPredictionsResolveHandler(),
  [CALIBRATION_RUN_JOB]: createCalibrationRunHandler(),
  [AUTOPSY_RUN_JOB]: createAutopsyRunHandler(),
  [LEARNING_NIGHTLY_JOB]: createLearningNightlyHandler(),
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

  // Health endpoint for PM2/uptime checks (WO-056): GET /health → 200 when
  // the loop is up AND the DB answers; 503 otherwise.
  const startedAt = Date.now();
  const health = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    getDb()
      .execute(sql`select 1`)
      .then(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workerId, uptimeSec: Math.round((Date.now() - startedAt) / 1000) }));
      })
      .catch(() => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, workerId, error: 'database unreachable' }));
      });
  });
  health.listen(env.WORKER_HEALTH_PORT, () => {
    console.log(`[worker] health endpoint on :${env.WORKER_HEALTH_PORT}/health`);
  });

  // Nightly learning loop (WO-048): sweep every 15 minutes; the enqueue gate
  // itself is idempotent per workspace per UTC day, so this is safe to spam.
  const nightlySweep = setInterval(() => {
    enqueueDueNightlyLearning().catch((err) =>
      console.error('[worker] nightly learning sweep failed', err),
    );
    // Entitlement safety net (WO-051): lapsed subscriptions flip inactive
    // well within a day even if Stripe's webhook never arrives.
    reapLapsedSubscriptions().catch((err) =>
      console.error('[worker] subscription reaper failed', err),
    );
  }, 15 * 60 * 1000);

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] received ${signal}, draining…`);
    clearInterval(nightlySweep);
    health.close();
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
