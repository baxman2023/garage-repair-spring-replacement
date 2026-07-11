import { JOB_TYPES } from '@copyforge/core';
import { resolvePredictions, runCalibration, type ClaimedJob } from '@copyforge/db';

/**
 * Prediction jobs (WO-045). Deterministic — no AI. The resolver scores
 * unresolved forecasts once volume thresholds clear; the calibration job
 * recomputes bounded adjustments and stores the report. WO-048's nightly
 * loop schedules both.
 */

export const PREDICTIONS_RESOLVE_JOB = JOB_TYPES.predictionsResolve;
export const CALIBRATION_RUN_JOB = JOB_TYPES.calibrationRun;

export function createPredictionsResolveHandler() {
  return async function handleResolve(job: ClaimedJob): Promise<void> {
    await resolvePredictions(job.workspaceId);
  };
}

export function createCalibrationRunHandler() {
  return async function handleCalibration(job: ClaimedJob): Promise<void> {
    await runCalibration(job.workspaceId);
  };
}
