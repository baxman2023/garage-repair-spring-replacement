import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  activateLicenseKey,
  assignSeat,
  licenseOverview,
  unassignSeat,
  workspaceAccess,
} from '@copyforge/db';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';

/**
 * Licensing & seats surface (WO-050). Reachable even when the caller is
 * locked out (the workspaceProcedure exempts `licensing.*`) so a lockout
 * shows the upsell instead of a dead end.
 */

const wrap = <T>(fn: () => Promise<T>): Promise<T> =>
  fn().catch((err) => {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: err instanceof Error ? err.message : 'Licensing operation failed.',
    });
  });

export const licensingRouter = router({
  /** Licenses, seats, members — plus the caller's own access verdict. */
  overview: workspaceProcedure.query(async ({ ctx }) => {
    const [overview, access] = await Promise.all([
      licenseOverview(ctx.workspaceId),
      workspaceAccess(ctx.workspaceId, ctx.auth.user.id),
    ]);
    return { ...overview, access, role: ctx.role };
  }),

  /** Activate a purchased key into this workspace. */
  activate: ownerProcedure
    .input(z.object({ key: z.string().trim().min(8).max(64) }))
    .mutation(({ ctx, input }) =>
      wrap(async () => {
        const license = await activateLicenseKey({ workspaceId: ctx.workspaceId, key: input.key });
        return { licenseId: license.id, seats: license.seats, type: license.type };
      }),
    ),

  assignSeat: ownerProcedure
    .input(z.object({ licenseId: z.string().length(26), userId: z.string().length(26) }))
    .mutation(({ ctx, input }) =>
      wrap(async () => {
        await assignSeat({ workspaceId: ctx.workspaceId, ...input });
        return { ok: true as const };
      }),
    ),

  unassignSeat: ownerProcedure
    .input(z.object({ licenseId: z.string().length(26), userId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await unassignSeat({ workspaceId: ctx.workspaceId, ...input });
      return { ok: true as const };
    }),
});
