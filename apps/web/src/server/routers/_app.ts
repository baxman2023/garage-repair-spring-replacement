import { env } from '@copyforge/core';
import { publicProcedure, router } from '../trpc';
import { authRouter } from './auth';
import { workspaceRouter } from './workspace';
import { apiKeyRouter } from './apiKey';
import { promptsRouter } from './prompts';
import { projectsRouter } from './projects';
import { intakeRouter } from './intake';
import { offersRouter } from './offers';
import { funnelMathRouter } from './funnelMath';
import { marketsRouter } from './markets';

/**
 * Root tRPC router. Feature routers mount here as later work orders add them.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    app: env.APP_NAME,
    time: new Date().toISOString(),
  })),
  auth: authRouter,
  workspace: workspaceRouter,
  apiKey: apiKeyRouter,
  prompts: promptsRouter,
  projects: projectsRouter,
  intake: intakeRouter,
  offers: offersRouter,
  funnelMath: funnelMathRouter,
  markets: marketsRouter,
});

export type AppRouter = typeof appRouter;
