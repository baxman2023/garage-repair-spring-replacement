import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { autopsyIntakeSchema } from '@copyforge/core';
import {
  createAutopsy,
  getAutopsy,
  listAutopsies,
  queueAutopsyRun,
  rebuildFromAutopsy,
  revokeAutopsyShare,
  shareAutopsy,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Autopsy Mode surface (WO-047). */

const scoped = z.object({ autopsyId: z.string().length(26) });

export const autopsyRouter = router({
  list: workspaceProcedure.query(({ ctx }) => listAutopsies(ctx.workspaceId)),

  get: workspaceProcedure.input(scoped).query(async ({ ctx, input }) => {
    const row = await getAutopsy(ctx.workspaceId, input.autopsyId);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Autopsy not found.' });
    return row;
  }),

  create: workspaceProcedure.input(autopsyIntakeSchema).mutation(async ({ ctx, input }) => {
    const autopsyId = await createAutopsy({ workspaceId: ctx.workspaceId, intake: input });
    const jobId = await queueAutopsyRun(ctx.workspaceId, autopsyId);
    return { autopsyId, jobId };
  }),

  /** Re-run the teardown (fresh report replaces the old one). */
  rerun: workspaceProcedure.input(scoped).mutation(async ({ ctx, input }) => {
    const jobId = await queueAutopsyRun(ctx.workspaceId, input.autopsyId);
    return { jobId };
  }),

  share: workspaceProcedure.input(scoped).mutation(async ({ ctx, input }) => {
    try {
      const token = await shareAutopsy(ctx.workspaceId, input.autopsyId);
      return { token, url: `/a/${token}` };
    } catch (err) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: err instanceof Error ? err.message : 'Cannot share.',
      });
    }
  }),

  revokeShare: workspaceProcedure.input(scoped).mutation(async ({ ctx, input }) => {
    await revokeAutopsyShare(ctx.workspaceId, input.autopsyId);
    return { ok: true as const };
  }),

  /** "Rebuild in CopyForge": new project + Sales Detective pre-fill. */
  rebuild: workspaceProcedure.input(scoped).mutation(async ({ ctx, input }) => {
    try {
      return await rebuildFromAutopsy({ workspaceId: ctx.workspaceId, autopsyId: input.autopsyId });
    } catch (err) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: err instanceof Error ? err.message : 'Cannot rebuild yet.',
      });
    }
  }),
});
