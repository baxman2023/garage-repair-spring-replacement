import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

/**
 * tRPC initialization for the CopyForge web app.
 *
 * The request context is intentionally minimal here; auth/session and the
 * workspace tenancy guard (`withWorkspace`) attach to it in WO-003/WO-004.
 */

export interface Context {
  /** Populated by auth middleware in later work orders. */
  readonly headers: Headers;
}

export async function createContext(opts: { req: Request }): Promise<Context> {
  return { headers: opts.req.headers };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;
