import { env } from '@copyforge/core';
import { publicProcedure, router } from '../trpc';

/**
 * Root tRPC router. Feature routers (auth, projects, assets, ledger, admin…)
 * mount here as later work orders add them.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    app: env.APP_NAME,
    time: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;
