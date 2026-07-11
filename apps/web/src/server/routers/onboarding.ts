import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { onboardingProgress, projects } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** "First Funnel Today" checklist (WO-054). */

export const onboardingRouter = router({
  progress: workspaceProcedure
    .input(z.object({ projectId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.findFirst(projects, eq(projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
      return onboardingProgress(ctx.workspaceId, input.projectId);
    }),
});
