import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { tenantDb, workspaceAccess, type TenantDb } from '@copyforge/db';
import type { WorkspaceRole } from '@copyforge/db';
import { getMembership, getSessionContext, type SessionContext } from './auth/service';
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

/**
 * Tenancy guard (WO-004): resolves the session's active workspace, verifies
 * membership, and injects `workspaceId`, the caller's `role`, and a
 * workspace-scoped `db` (tenantDb) into the context. Every workspace-scoped
 * procedure builds on this so cross-tenant access is structurally impossible.
 */
export const workspaceProcedure = protectedProcedure.use(async ({ ctx, next, path, type }) => {
  const workspaceId = ctx.auth.session.activeWorkspaceId;
  if (!workspaceId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active workspace.' });
  }
  const membership = await getMembership(workspaceId, ctx.auth.user.id);
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this workspace.' });
  }

  // Seat enforcement (WO-050): $1,000/user, structurally. The licensing
  // surface itself stays reachable so owners can fix a lockout (assign or
  // buy seats) without a support ticket.
  const access = await workspaceAccess(workspaceId, ctx.auth.user.id);
  const licensingSurface = path.startsWith('licensing.');
  if (!licensingSurface) {
    if (access.mode === 'locked') {
      throw new TRPCError({ code: 'FORBIDDEN', message: access.reason ?? 'No licensed seat.' });
    }
    if (access.mode === 'readonly' && type === 'mutation') {
      throw new TRPCError({ code: 'FORBIDDEN', message: access.reason ?? 'Workspace is read-only.' });
    }
  }

  const db: TenantDb = tenantDb(workspaceId);
  const role: WorkspaceRole = membership.role;
  return next({ ctx: { ...ctx, workspaceId, role, db, access } });
});

/** Requires the caller to be an owner of the active workspace. */
export const ownerProcedure = workspaceProcedure.use(({ ctx, next }) => {
  if (ctx.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owners only.' });
  }
  return next({ ctx });
});

/** Requires a platform administrator (separate from workspace roles). */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.auth.user.isPlatformAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform administrators only.' });
  }
  return next({ ctx });
});
