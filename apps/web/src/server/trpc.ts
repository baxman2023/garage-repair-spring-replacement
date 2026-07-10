import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { getSessionContext, type SessionContext } from './auth/service';
import { SESSION_COOKIE, parseCookieHeader } from './auth/cookies';

/**
 * tRPC initialization for the CopyForge web app.
 *
 * The request context carries the resolved session (if any). The workspace
 * tenancy guard (`withWorkspace`) is layered on in WO-004.
 */

export interface Context {
  readonly headers: Headers;
  readonly rawSessionToken?: string;
  readonly auth: SessionContext | null;
}

export async function createContext(opts: { req: Request }): Promise<Context> {
  const cookies = parseCookieHeader(opts.req.headers.get('cookie'));
  const rawSessionToken = cookies[SESSION_COOKIE];
  const auth = await getSessionContext(rawSessionToken);
  return { headers: opts.req.headers, rawSessionToken, auth };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;

/** Requires an authenticated session; narrows `ctx.auth` to non-null. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required.' });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});
