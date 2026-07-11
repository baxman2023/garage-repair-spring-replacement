import { and, eq, gte } from 'drizzle-orm';
import { JOB_TYPES } from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  assets as assetsTable,
  enqueueBuildStep,
  getBuild,
  getBuildStep,
  listBuildSteps,
  setBuildStatus,
  tenantDb,
  updateBuildStep,
  type ClaimedJob,
} from '@copyforge/db';
import { dispatchGeneration } from './generate.js';

/**
 * Chained build-step handler (WO-028). Each job runs ONE step of a funnel
 * build, then enqueues the next — strictly sequential regardless of worker
 * count, so the §1.2 market cache block stays warm across a market's assets.
 *
 * Resume safety: a step whose assets already exist (created after the build
 * started) is treated as done, not regenerated — a worker killed between
 * generation and bookkeeping resumes WITHOUT duplicates.
 */

export const BUILD_STEP_JOB = JOB_TYPES.buildStep;

export function createBuildStepHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleBuildStep(job: ClaimedJob): Promise<void> {
    const buildId = String(job.payload.buildId ?? '');
    const seq = Number(job.payload.seq ?? Number.NaN);
    if (!buildId || Number.isNaN(seq)) {
      throw new Error('build.step job missing buildId/seq');
    }

    const build = await getBuild(job.workspaceId, buildId);
    if (!build) throw new Error(`Build "${buildId}" not found.`);
    // Cancel: stop the chain quietly; cancelFunnelBuild already skipped the rest.
    if (build.status === 'canceled') return;

    const step = await getBuildStep(job.workspaceId, buildId, seq);
    if (!step) throw new Error(`Build step ${seq} not found for build "${buildId}".`);

    if (step.status !== 'done') {
      // Dedupe: if this step's asset type already exists for the market (created
      // by this build), a previous attempt finished generating before it could
      // record 'done' — count it instead of regenerating.
      const existing = await tenantDb(job.workspaceId).findMany(
        assetsTable,
        and(
          eq(assetsTable.projectId, build.projectId),
          eq(assetsTable.marketId, step.marketId),
          eq(assetsTable.type, step.assetType),
          gte(assetsTable.createdAt, build.createdAt),
        ),
      );
      if (existing.length > 0) {
        await updateBuildStep(job.workspaceId, step.id, {
          status: 'done',
          jobId: job.id,
          assetIds: existing.map((a) => a.id),
        });
      } else {
        await updateBuildStep(job.workspaceId, step.id, { status: 'running', jobId: job.id });
        try {
          await dispatchGeneration(ai, {
            workspaceId: job.workspaceId,
            projectId: build.projectId,
            marketId: step.marketId,
            assetType: step.assetType,
            jobId: job.id,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await updateBuildStep(job.workspaceId, step.id, {
            status: 'failed',
            error: message.slice(0, 1024),
          });
          throw err; // queue-level retry/backoff still applies
        }
        const produced = await tenantDb(job.workspaceId).findMany(
          assetsTable,
          and(
            eq(assetsTable.projectId, build.projectId),
            eq(assetsTable.marketId, step.marketId),
            eq(assetsTable.type, step.assetType),
            gte(assetsTable.createdAt, build.createdAt),
          ),
        );
        await updateBuildStep(job.workspaceId, step.id, {
          status: 'done',
          assetIds: produced.map((a) => a.id),
        });
      }
    }

    // Chain: enqueue the next non-done step, or finish the build.
    const steps = await listBuildSteps(job.workspaceId, buildId);
    const next = steps.find((s) => s.seq > seq && s.status !== 'done' && s.status !== 'skipped');
    if (next) {
      await enqueueBuildStep(job.workspaceId, build.projectId, buildId, next.seq);
    } else {
      await setBuildStatus(job.workspaceId, buildId, 'done');
    }
  };
}
