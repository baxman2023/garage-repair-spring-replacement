import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb, workspaces } from '@copyforge/db';
import { protectedProcedure, router } from '../trpc';
import { createWorkspaceInvite, getMembership, listMembers } from '../auth/service';

export const workspaceRouter = router({
  /** Active workspace + the caller's role in it. */
  current: protectedProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.auth.session.activeWorkspaceId;
    if (!workspaceId) return null;
    const membership = await getMembership(workspaceId, ctx.auth.user.id);
    const rows = await getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const ws = rows[0];
    if (!ws || !membership) return null;
    return { id: ws.id, name: ws.name, role: membership.role };
  }),

  /** Members of the active workspace. */
  members: protectedProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.auth.session.activeWorkspaceId;
    if (!workspaceId) return [];
    return listMembers(workspaceId);
  }),

  /** Invite an email to the active workspace (owners only). */
  invite: protectedProcedure
    .input(z.object({ email: z.string().email(), role: z.enum(['owner', 'member']).default('member') }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.auth.session.activeWorkspaceId;
      if (!workspaceId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active workspace.' });
      }
      const membership = await getMembership(workspaceId, ctx.auth.user.id);
      if (!membership || membership.role !== 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only owners can invite.' });
      }
      await createWorkspaceInvite({
        workspaceId,
        email: input.email,
        role: input.role,
        invitedByUserId: ctx.auth.user.id,
      });
      return { ok: true as const };
    }),
});
