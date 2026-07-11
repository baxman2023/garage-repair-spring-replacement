import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../trpc';
import { changePassword, requestMagicLink } from '../auth/service';
import { MIN_PASSWORD_LENGTH } from '../auth/password';

export const authRouter = router({
  /** Send a magic-link email. Always returns ok (no account enumeration). */
  requestLink: publicProcedure
    .input(z.object({ email: z.string().email(), next: z.string().optional() }))
    .mutation(async ({ input }) => {
      await requestMagicLink(input.email, input.next);
      return { ok: true as const };
    }),

  /** Change (or first-set) the signed-in user's password. */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(MIN_PASSWORD_LENGTH, {
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await changePassword(
        ctx.auth.user.id,
        input.currentPassword,
        input.newPassword,
      );
      if ('error' in result) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.error });
      }
      return { ok: true as const };
    }),

  /** Current session summary, or null when signed out. */
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.auth) return null;
    return {
      user: {
        id: ctx.auth.user.id,
        email: ctx.auth.user.email,
        name: ctx.auth.user.name,
        isPlatformAdmin: ctx.auth.user.isPlatformAdmin,
      },
      activeWorkspaceId: ctx.auth.session.activeWorkspaceId,
    };
  }),
});
