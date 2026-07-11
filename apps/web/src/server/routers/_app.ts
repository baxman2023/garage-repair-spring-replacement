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
import { vocRouter } from './voc';
import { strategyRouter } from './strategy';
import { genomeRouter } from './genome';
import { councilRouter } from './council';
import { assetsRouter } from './assets';
import { buildRouter } from './build';
import { focusGroupRouter } from './focusGroup';
import { claimsRouter } from './claims';
import { complianceRouter } from './compliance';

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
  voc: vocRouter,
  strategy: strategyRouter,
  genome: genomeRouter,
  council: councilRouter,
  assets: assetsRouter,
  build: buildRouter,
  focusGroup: focusGroupRouter,
  claims: claimsRouter,
  compliance: complianceRouter,
});

export type AppRouter = typeof appRouter;
