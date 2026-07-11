import { assertEnv } from '@copyforge/core';
import { installConsoleRedaction } from '@copyforge/ai';
import { closePool } from '@copyforge/db';
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
