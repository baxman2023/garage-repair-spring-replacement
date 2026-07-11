import { and, eq, gt, isNull } from 'drizzle-orm';
import { env, newId } from '@copyforge/core';
import {
  authTokens,
  getDb,
  sessions,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type WorkspaceRole,
} from '@copyforge/db';
import { sendMail } from './email';
import {
  INVITE_TTL_MS,
  MAGIC_LINK_TTL_MS,
  SESSION_TTL_MS,
  expiryFrom,
  generateRawToken,
  hashToken,
  isExpired,
  normalizeEmail,
} from './tokens';

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

function defaultWorkspaceName(email: string): string {
  const handle = email.split('@')[0] ?? 'My';
  return `${handle}'s Workspace`;
}

// --- Magic-link login -------------------------------------------------------

/** Create a magic-link token and email it. Returns the link (also useful in tests). */
export async function requestMagicLink(rawEmail: string, next?: string): Promise<{ link: string }> {
  const db = getDb();
  const email = normalizeEmail(rawEmail);

  // Kill switch (WO-052): signups off → no link for UNKNOWN emails. Existing
  // users keep signing in; the response stays identical (no enumeration).
  const { flagEnabled } = await import('@copyforge/db');
  if (!(await flagEnabled('signups_enabled', true))) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!existing[0]) return { link: '' };
  }

  const raw = generateRawToken();
  await db.insert(authTokens).values({
    id: newId(),
    email,
    tokenHash: hashToken(raw),
    expiresAt: expiryFrom(MAGIC_LINK_TTL_MS),
  });
  const params = new URLSearchParams({ token: raw });
  if (next) params.set('next', next);
  const link = `${env.APP_URL}/auth/verify?${params.toString()}`;
  await sendMail({
    to: email,
    subject: `Sign in to ${env.APP_NAME}`,
    text: `Click to sign in to ${env.APP_NAME} (expires in 15 minutes):\n${link}`,
    html: `<p>Click to sign in to ${env.APP_NAME} (expires in 15 minutes):</p><p><a href="${link}">${link}</a></p>`,
  });
  return { link };
}

export interface VerifyResult {
  rawSessionToken: string;
  user: User;
  workspaceId: string;
}

/**
 * Verify a magic-link token: single-use + expiry enforced atomically. On
 * success, find-or-create the user, ensure they have a workspace, and mint a
 * session. Returns null for invalid / expired / already-consumed tokens.
 */
export async function verifyMagicLink(rawToken: string): Promise<VerifyResult | null> {
  const db = getDb();
  const hash = hashToken(rawToken);
  const now = new Date();

  const rows = await db
    .select({ email: authTokens.email })
    .from(authTokens)
    .where(eq(authTokens.tokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Atomic single-use consume: only one caller can flip consumed_at.
  const consumed = await db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, now),
      ),
    );
  if (consumed[0].affectedRows !== 1) return null;

  const user = await findOrCreateUser(row.email);
  const workspaceId = await ensureWorkspaceForUser(user);
  const rawSessionToken = await createSession(user.id, workspaceId);
  return { rawSessionToken, user, workspaceId };
}

async function findOrCreateUser(email: string): Promise<User> {
  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0];
  const id = newId();
  await db.insert(users).values({ id, email });
  const created = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return created[0]!;
}

/** Create-on-first-login: give the user an owner workspace if they have none. */
export async function ensureWorkspaceForUser(user: User): Promise<string> {
  const db = getDb();
  const membership = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1);
  if (membership[0]) return membership[0].workspaceId;

  const workspaceId = newId();
  await db.insert(workspaces).values({
    id: workspaceId,
    name: defaultWorkspaceName(user.email),
    ownerUserId: user.id,
  });
  await db.insert(workspaceMembers).values({
    id: newId(),
    workspaceId,
    userId: user.id,
    role: 'owner',
  });
  return workspaceId;
}

// --- Sessions ---------------------------------------------------------------

/** Mint a session and return the raw token to store in the cookie. */
export async function createSession(userId: string, activeWorkspaceId: string): Promise<string> {
  const db = getDb();
  const raw = generateRawToken();
  await db.insert(sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(raw),
    activeWorkspaceId,
    expiresAt: expiryFrom(SESSION_TTL_MS),
  });
  return raw;
}

export interface SessionContext {
  user: User;
  session: Session;
}

/** Resolve a raw session cookie to its user, deleting it if expired. */
export async function getSessionContext(
  rawSessionToken: string | undefined | null,
): Promise<SessionContext | null> {
  if (!rawSessionToken) return null;
  const db = getDb();
  const hash = hashToken(rawSessionToken);
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, hash)).limit(1);
  const session = rows[0];
  if (!session) return null;
  if (isExpired(session.expiresAt)) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }
  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;
  return { user, session };
}

/** Destroy a session (logout). */
export async function destroySession(rawSessionToken: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(rawSessionToken)));
}

/** Switch the workspace a session is acting within. */
export async function setSessionActiveWorkspace(
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  const db = getDb();
  await db.update(sessions).set({ activeWorkspaceId: workspaceId }).where(eq(sessions.id, sessionId));
}

// --- Workspaces & invites ---------------------------------------------------

export async function getMembership(
  workspaceId: string,
  userId: string,
): Promise<{ role: WorkspaceRole } | null> {
  const db = getDb();
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  const db = getDb();
  return db
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      name: users.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}

/** Create an invite token for an email + role and send the accept link. */
export async function createWorkspaceInvite(params: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedByUserId: string;
}): Promise<{ link: string }> {
  const db = getDb();
  const email = normalizeEmail(params.email);
  const raw = generateRawToken();
  await db.insert(workspaceInvites).values({
    id: newId(),
    workspaceId: params.workspaceId,
    email,
    role: params.role,
    tokenHash: hashToken(raw),
    invitedByUserId: params.invitedByUserId,
    expiresAt: expiryFrom(INVITE_TTL_MS),
  });
  const link = `${env.APP_URL}/invite/accept?token=${raw}`;
  await sendMail({
    to: email,
    subject: `You've been invited to a workspace on ${env.APP_NAME}`,
    text: `Accept your invite (expires in 7 days):\n${link}`,
    html: `<p>Accept your invite (expires in 7 days):</p><p><a href="${link}">${link}</a></p>`,
  });
  return { link };
}

export type AcceptInviteResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/** Accept an invite for a logged-in user, adding workspace membership. */
export async function acceptInvite(
  rawToken: string,
  userId: string,
): Promise<AcceptInviteResult> {
  const db = getDb();
  const hash = hashToken(rawToken);
  const rows = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.tokenHash, hash))
    .limit(1);
  const invite = rows[0];
  if (!invite) return { ok: false, reason: 'invalid' };
  if (invite.acceptedAt) return { ok: false, reason: 'used' };
  if (isExpired(invite.expiresAt)) return { ok: false, reason: 'expired' };

  const accepted = await db
    .update(workspaceInvites)
    .set({ acceptedAt: new Date() })
    .where(and(eq(workspaceInvites.id, invite.id), isNull(workspaceInvites.acceptedAt)));
  if (accepted[0].affectedRows !== 1) return { ok: false, reason: 'used' };

  const existing = await getMembership(invite.workspaceId, userId);
  if (!existing) {
    await db.insert(workspaceMembers).values({
      id: newId(),
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
    });
  }
  return { ok: true, workspaceId: invite.workspaceId };
}
