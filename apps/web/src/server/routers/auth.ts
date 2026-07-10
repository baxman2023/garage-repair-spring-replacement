import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { requestMagicLink } from '../auth/service';

export const authRouter = router({
  /** Send a magic-link email. Always returns ok (no account enumeration). */
  requestLink: publicProcedure
    .input(z.object({ email: z.string().email(), next: z.string().optional() }))
    .mutation(async ({ input }) => {
      await requestMagicLink(input.email, input.next);
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
