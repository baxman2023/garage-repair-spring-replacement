import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { closePool, getDb, setFlag, setPausedJobTypes, users } from '@copyforge/db';
import type { SessionContext } from '../auth/service';
import { appRouter } from './_app';
import { createCallerFactory, type Context } from '../trpc';
import { requestMagicLink } from '../auth/service';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[admin.test] MariaDB unreachable — skipping');
  }
});
afterEach(async () => {
  if (!dbUp) return;
  await setFlag({ key: 'signups_enabled', enabled: true });
  await setPausedJobTypes([]);
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function callerFor(isPlatformAdmin: boolean) {
  const auth = {
    user: {
      id: newId(),
      email: `caller-${newId().toLowerCase()}@example.test`,
      name: null,
      isPlatformAdmin,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: newId(),
      userId: newId(),
      tokenHash: 'x',
      activeWorkspaceId: newId(),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as SessionContext;
  const ctx: Context = { headers: new Headers(), auth };
  return createCallerFactory(appRouter)(ctx);
}

describe('admin panel guard (WO-052 acceptance)', () => {
  it('every admin route is FORBIDDEN for a normal workspace owner', async () => {
    if (!dbUp) return;
    const owner = callerFor(false);
    await expect(owner.admin.flags()).rejects.toThrow(/Platform administrators only/);
    await expect(owner.admin.search({ query: 'x' })).rejects.toThrow(/Platform administrators only/);
    await expect(owner.admin.usage()).rejects.toThrow(/Platform administrators only/);
    await expect(owner.admin.modelRoutes()).rejects.toThrow(/Platform administrators only/);
    await expect(owner.admin.setFlag({ key: 'signups_enabled', enabled: false })).rejects.toThrow(
      /Platform administrators only/,
    );
    // The admin-guarded prompt registry refuses too.
    await expect(owner.prompts.names()).rejects.toThrow(/Platform administrators only/);
  });

  it('a platform admin passes the guard and reaches the surfaces', async () => {
    if (!dbUp) return;
    const admin = callerFor(true);
    const flags = await admin.admin.flags();
    expect(flags.knownJobTypes).toContain('asset.generate');
    const routes = await admin.admin.modelRoutes();
    expect(routes.some((r) => r.stage === 'council')).toBe(true);
    const search = await admin.admin.search({ query: 'no-such-thing-zzz' });
    expect(search).toEqual({ users: [], workspaces: [], licenses: [] });
  });
});

describe('signups kill switch (WO-052)', () => {
  it('signups_enabled off: unknown emails get no account, existing users still sign in', async () => {
    if (!dbUp) return;
    const admin = callerFor(true);

    // Existing user first (created while signups are on).
    const existingEmail = `existing-${newId().toLowerCase()}@example.test`;
    await requestMagicLink(existingEmail); // issues a token but no user yet
    await getDb().insert(users).values({ id: newId(), email: existingEmail });

    await admin.admin.setFlag({ key: 'signups_enabled', enabled: false });

    const blocked = await requestMagicLink(`fresh-${newId().toLowerCase()}@example.test`);
    expect(blocked.link).toBe(''); // no token, no email, same-shaped response

    const allowed = await requestMagicLink(existingEmail);
    expect(allowed.link).toContain('/auth/verify?token=');
  });
});
