import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { authTokens, closePool, getDb } from '@copyforge/db';
import {
  acceptInvite,
  changePassword,
  createWorkspaceInvite,
  destroySession,
  getSessionContext,
  listMembers,
  loginWithPassword,
  registerWithPassword,
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

  it('registers with a password, logs in, and rejects bad credentials', async () => {
    if (!dbUp) return;
    const email = uniqueEmail('pw');

    const reg = await registerWithPassword(email, 'first-password', 'PW Tester');
    expect('error' in reg).toBe(false);
    if ('error' in reg) return;
    expect(reg.user.email).toBe(email);
    expect(reg.workspaceId).toMatch(/^[0-9A-Z]{26}$/);
    // Registration mints a working session immediately.
    expect((await getSessionContext(reg.rawSessionToken))?.user.id).toBe(reg.user.id);

    // Duplicate registration is refused.
    const dup = await registerWithPassword(email, 'another-password');
    expect('error' in dup).toBe(true);

    // Login: right password works, wrong password and unknown email share one error.
    const login = await loginWithPassword(email, 'first-password');
    expect('error' in login).toBe(false);
    const bad = await loginWithPassword(email, 'wrong-password');
    const ghost = await loginWithPassword(uniqueEmail('ghost'), 'first-password');
    expect(bad).toEqual({ error: 'Invalid email or password.' });
    expect(ghost).toEqual({ error: 'Invalid email or password.' });
  });

  it('changes passwords, requiring the current one once set', async () => {
    if (!dbUp) return;
    const email = uniqueEmail('pwchange');
    const reg = await registerWithPassword(email, 'original-pass');
    if ('error' in reg) throw new Error(reg.error);

    // Wrong current password is refused; the right one goes through.
    expect(await changePassword(reg.user.id, 'nope', 'replacement-pass')).toHaveProperty('error');
    expect(await changePassword(reg.user.id, 'original-pass', 'replacement-pass')).toEqual({
      ok: true,
    });
    expect('error' in (await loginWithPassword(email, 'original-pass'))).toBe(true);
    expect('error' in (await loginWithPassword(email, 'replacement-pass'))).toBe(false);
  });

  it('lets magic-link-era accounts (no hash) set a first password', async () => {
    if (!dbUp) return;
    const email = uniqueEmail('legacy');
    const legacy = (await verifyMagicLink(
      tokenFromLink((await requestMagicLink(email)).link),
    ))!;
    // No password yet → login refused, but a first set needs no current password.
    expect('error' in (await loginWithPassword(email, 'brand-new-pass'))).toBe(true);
    expect(await changePassword(legacy.user.id, '', 'brand-new-pass')).toEqual({ ok: true });
    expect('error' in (await loginWithPassword(email, 'brand-new-pass'))).toBe(false);
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
