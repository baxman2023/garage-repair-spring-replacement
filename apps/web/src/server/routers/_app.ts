import { env } from '@copyforge/core';
import { publicProcedure, router } from '../trpc';
import { authRouter } from './auth';
import { workspaceRouter } from './workspace';
import { apiKeyRouter } from './apiKey';
import { promptsRouter } from './prompts';
import { projectsRouter } from './projects';
import { intakeRouter } from './intake';

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
});

export type AppRouter = typeof appRouter;
