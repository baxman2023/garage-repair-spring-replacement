import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { authTokens, closePool, getDb } from '@copyforge/db';
import {
  acceptInvite,
  createWorkspaceInvite,
  destroySession,
  getSessionContext,
  listMembers,
  requestMagicLink,
  verifyMagicLink,
} from './service';
import { expiryFrom, generateRawToken, hashToken } from './tokens';

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

let dbUp = false;

beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[service.test] MariaDB unreachable — skipping DB-backed auth tests');
  }
});

afterAll(async () => {
  if (dbUp) await closePool();
});

describe('auth service (DB-backed)', () => {
  it('runs the full login → workspace → invite → accept path', async () => {
    if (!dbUp) return;
    const ownerEmail = uniqueEmail('owner');

    // 1. Request + verify magic link → create-on-first-login.
    const { link } = await requestMagicLink(ownerEmail);
    const result = await verifyMagicLink(tokenFromLink(link));
    expect(result).not.toBeNull();
    const owner = result!;
    expect(owner.user.email).toBe(ownerEmail);
    expect(owner.workspaceId).toMatch(/^[0-9A-Z]{26}$/);

    // Session resolves back to the user.
    const ctx = await getSessionContext(owner.rawSessionToken);
    expect(ctx?.user.id).toBe(owner.user.id);
    expect(ctx?.session.activeWorkspaceId).toBe(owner.workspaceId);

    // 2. Owner invites a teammate.
    const memberEmail = uniqueEmail('member');
    const invite = await createWorkspaceInvite({
      workspaceId: owner.workspaceId,
      email: memberEmail,
      role: 'member',
      invitedByUserId: owner.user.id,
    });

    // 3. Teammate logs in (own workspace created), then accepts the invite.
    const memberLogin = await verifyMagicLink(
      tokenFromLink((await requestMagicLink(memberEmail)).link),
    );
    const member = memberLogin!;
    const accept = await acceptInvite(tokenFromLink(invite.link), member.user.id);
    expect(accept.ok).toBe(true);
    if (accept.ok) expect(accept.workspaceId).toBe(owner.workspaceId);

    // Both users are now members of the owner's workspace.
    const members = await listMembers(owner.workspaceId);
    const emails = members.map((m) => m.email).sort();
    expect(emails).toEqual([memberEmail, ownerEmail].sort());
    expect(members.find((m) => m.email === ownerEmail)?.role).toBe('owner');
    expect(members.find((m) => m.email === memberEmail)?.role).toBe('member');
  });

  it('keeps sessions valid across a pool restart', async () => {
    if (!dbUp) return;
    const email = uniqueEmail('persist');
    const login = (await verifyMagicLink(
      tokenFromLink((await requestMagicLink(email)).link),
    ))!;

    // Simulate a process restart: drop the connection pool entirely.
    await closePool();

    const ctx = await getSessionContext(login.rawSessionToken);
    expect(ctx?.user.email).toBe(email);
  });

  it('rejects expired magic-link tokens', async () => {
    if (!dbUp) return;
    const raw = generateRawToken();
    await getDb().insert(authTokens).values({
      id: newId(),
      email: uniqueEmail('expired'),
      tokenHash: hashToken(raw),
      expiresAt: expiryFrom(-1000), // already in the past
    });
    expect(await verifyMagicLink(raw)).toBeNull();
  });

  it('rejects reused (single-use) magic-link tokens', async () => {
    if (!dbUp) return;
    const email = uniqueEmail('reuse');
    const raw = tokenFromLink((await requestMagicLink(email)).link);
    expect(await verifyMagicLink(raw)).not.toBeNull(); // first use ok
    expect(await verifyMagicLink(raw)).toBeNull(); // second use rejected
  });

  it('destroys sessions on logout', async () => {
    if (!dbUp) return;
    const email = uniqueEmail('logout');
    const login = (await verifyMagicLink(
      tokenFromLink((await requestMagicLink(email)).link),
    ))!;
    await destroySession(login.rawSessionToken);
    expect(await getSessionContext(login.rawSessionToken)).toBeNull();
  });
});
