import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, workspaces } from '@copyforge/db';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';
import { createWorkspaceInvite, listMembers } from '../auth/service';

export const workspaceRouter = router({
  /** Active workspace + the caller's role in it. */
  current: workspaceProcedure.query(async ({ ctx }) => {
    const rows = await getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId))
      .limit(1);
    const ws = rows[0];
    if (!ws) return null;
    return { id: ws.id, name: ws.name, role: ctx.role };
  }),

  /** Members of the active workspace. */
  members: workspaceProcedure.query(({ ctx }) => listMembers(ctx.workspaceId)),

  /** Invite an email to the active workspace (owners only). */
  invite: ownerProcedure
    .input(z.object({ email: z.string().email(), role: z.enum(['owner', 'member']).default('member') }))
    .mutation(async ({ ctx, input }) => {
      await createWorkspaceInvite({
        workspaceId: ctx.workspaceId,
        email: input.email,
        role: input.role,
        invitedByUserId: ctx.auth.user.id,
      });
      return { ok: true as const };
    }),
});
