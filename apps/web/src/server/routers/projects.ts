import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { projects } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

export const projectsRouter = router({
  list: workspaceProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.findMany(projects, undefined);
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => ({ id: p.id, name: p.name, status: p.status, createdAt: p.createdAt }));
  }),

  create: workspaceProcedure
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const id = await ctx.db.insert(projects, {
        name: input.name,
        createdByUserId: ctx.auth.user.id,
      });
      return { id };
    }),

  get: workspaceProcedure
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.findFirst(projects, eq(projects.id, input.id));
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        currentProfileId: project.currentProfileId,
      };
    }),
});
