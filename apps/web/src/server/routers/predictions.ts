import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  getCalibration,
  listPredictionsForProject,
  projects,
  resolvePredictions,
  runCalibration,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Predictions & calibration surface (WO-045). */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const predictionsRouter = router({
  /** Predictions alongside actuals per asset (acceptance). */
  list: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const [rows, calibration] = await Promise.all([
      listPredictionsForProject(ctx.workspaceId, input.projectId),
      getCalibration(ctx.workspaceId),
    ]);
    return { predictions: rows, calibration };
  }),

  /** Run the resolver now (WO-048 schedules it nightly). */
  resolveNow: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    return resolvePredictions(ctx.workspaceId);
  }),

  /** Run calibration now and return the report. */
  calibrateNow: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    return runCalibration(ctx.workspaceId);
  }),
});
