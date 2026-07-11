import { desc, eq } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { enqueueJob, type EnqueueParams } from './queue.js';
import { funnelMathRuns, gateReports, projects } from './schema/index.js';

/**
 * Funnel-math persistence + the G1 hard stop (WO-011).
 *
 * `enqueueGenerationJob` is the single enqueue path for generation-class jobs
 * (market selection, fan-out, asset drafting…): it refuses to enqueue unless
 * the project's latest funnel-math run passed. Intake and offer-forge jobs are
 * pre-G1 by design and use plain `enqueueJob`.
 */

export type FunnelMathRunRow = typeof funnelMathRuns.$inferSelect;

export async function recordFunnelMathRun(params: {
  workspaceId: string;
  projectId: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  pass: boolean;
  report: Record<string, unknown>;
}): Promise<string> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const project = await tx
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);
    if (!project[0] || project[0].workspaceId !== params.workspaceId) {
      throw new Error('Project not found in this workspace.');
    }
    const id = newId();
    await tx.insert(funnelMathRuns).values({
      id,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      inputs: params.inputs,
      outputs: params.outputs,
      pass: params.pass,
      report: params.report,
    });
    await tx.insert(gateReports).values({
      id: newId(),
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      assetId: null,
      gate: 'G1',
      pass: params.pass,
      report: params.report,
    });
    return id;
  });
}

export async function latestFunnelMathRun(
  workspaceId: string,
  projectId: string,
): Promise<FunnelMathRunRow | null> {
  const rows = await getDb()
    .select()
    .from(funnelMathRuns)
    .where(eq(funnelMathRuns.projectId, projectId))
    .orderBy(desc(funnelMathRuns.createdAt), desc(funnelMathRuns.id))
    .limit(5);
  return rows.find((r) => r.workspaceId === workspaceId) ?? null;
}

/** G1 hard stop: throws unless the project's latest funnel-math run passed. */
export async function assertG1Passed(workspaceId: string, projectId: string): Promise<void> {
  const latest = await latestFunnelMathRun(workspaceId, projectId);
  if (!latest) {
    throw new Error('G1 hard stop: run Funnel Math before generating — no run exists.');
  }
  if (!latest.pass) {
    throw new Error(
      'G1 hard stop: the latest funnel-math run failed. Fix the offer economics (G0) and re-run before generating.',
    );
  }
}

/** Enqueue a generation-class job, enforcing the G1 hard stop. */
export async function enqueueGenerationJob(params: EnqueueParams & { projectId: string }): Promise<string> {
  await assertG1Passed(params.workspaceId, params.projectId);
  return enqueueJob(params);
}
