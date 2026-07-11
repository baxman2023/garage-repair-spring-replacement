import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import {
  activateLicenseKey,
  assignSeat,
  BETA_EXPIRED_MESSAGE,
  issueLicense,
  licenseOverview,
  revokeLicenseByKey,
  unassignSeat,
  UPSELL_MESSAGE,
  workspaceAccess,
} from './licenseStore.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[licenseStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('licensing & seats (WO-050)', () => {
  it('issue → activate binds the key once; revoke kills it', async () => {
    if (!dbUp) return;
    const wsA = newId();
    const wsB = newId();
    const { key } = await issueLicense({ seats: 2 });

    const activated = await activateLicenseKey({ workspaceId: wsA, key });
    expect(activated.workspaceId).toBe(wsA);
    expect(activated.seats).toBe(2);
    // Idempotent for the same workspace; refused for another.
    await expect(activateLicenseKey({ workspaceId: wsA, key })).resolves.toBeTruthy();
    await expect(activateLicenseKey({ workspaceId: wsB, key })).rejects.toThrow(/another workspace/);
    await expect(activateLicenseKey({ workspaceId: wsB, key: 'lic_nope' })).rejects.toThrow(/Unknown/);

    await revokeLicenseByKey(key);
    await expect(activateLicenseKey({ workspaceId: wsA, key })).rejects.toThrow(/revoked/);
  });

  it('ACCEPTANCE: seat 3 on a 2-seat license cannot enter the workspace (upsell shown)', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const [u1, u2, u3] = [newId(), newId(), newId()];
    const { licenseId, key } = await issueLicense({ seats: 2 });
    await activateLicenseKey({ workspaceId, key });

    await assignSeat({ workspaceId, licenseId, userId: u1 });
    await assignSeat({ workspaceId, licenseId, userId: u2 });
    // Same named user again: idempotent, does not burn a seat.
    await assignSeat({ workspaceId, licenseId, userId: u1 });

    // The third named user cannot take a seat — clear upsell in the error.
    await expect(assignSeat({ workspaceId, licenseId, userId: u3 })).rejects.toThrow(/All 2 seats.*\$1,000/);

    // And without a seat, access to the licensed workspace is LOCKED.
    expect(await workspaceAccess(workspaceId, u1)).toEqual({ mode: 'full', reason: null });
    const locked = await workspaceAccess(workspaceId, u3);
    expect(locked.mode).toBe('locked');
    expect(locked.reason).toBe(UPSELL_MESSAGE);
    expect(locked.reason).toContain('$1,000');

    // Freeing a seat lets the next named user in.
    await unassignSeat({ workspaceId, licenseId, userId: u2 });
    await assignSeat({ workspaceId, licenseId, userId: u3 });
    expect((await workspaceAccess(workspaceId, u3)).mode).toBe('full');
    expect((await workspaceAccess(workspaceId, u2)).mode).toBe('locked');
  });

  it('ACCEPTANCE: beta (Forge Vault) expiry degrades to read-only, not lockout', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const userId = newId();
    const { licenseId, key } = await issueLicense({
      seats: 1,
      type: 'beta',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await activateLicenseKey({ workspaceId, key });
    await assignSeat({ workspaceId, licenseId, userId });
    expect((await workspaceAccess(workspaceId, userId)).mode).toBe('full');

    // Expire the beta license (simulate the clock passing).
    const { licenses } = await import('./schema/index.js');
    const { eq } = await import('drizzle-orm');
    await getDb().update(licenses).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(licenses.id, licenseId));

    const access = await workspaceAccess(workspaceId, userId);
    expect(access.mode).toBe('readonly');
    expect(access.reason).toBe(BETA_EXPIRED_MESSAGE);
    expect(access.reason).toContain('read-only');

    // The lazy reaper stamped the license expired in the overview too.
    const overview = await licenseOverview(workspaceId);
    expect(overview.licenses[0]!.status).toBe('expired');
    expect(overview.licenses[0]!.valid).toBe(false);

    // A fresh standard seat restores full access (graceful upgrade path).
    const upgrade = await issueLicense({ seats: 1, workspaceId });
    await assignSeat({ workspaceId, licenseId: upgrade.licenseId, userId });
    expect((await workspaceAccess(workspaceId, userId)).mode).toBe('full');
  });

  it('an unlicensed workspace stays fully accessible (trial mode); expired seats on standard licenses lock', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const userId = newId();
    expect(await workspaceAccess(workspaceId, userId)).toEqual({ mode: 'full', reason: null });

    // Expired STANDARD license → lockout (only beta degrades to read-only).
    const { licenseId, key } = await issueLicense({ seats: 1, expiresAt: new Date(Date.now() + 60_000) });
    await activateLicenseKey({ workspaceId, key });
    await assignSeat({ workspaceId, licenseId, userId });
    const { licenses } = await import('./schema/index.js');
    const { eq } = await import('drizzle-orm');
    await getDb().update(licenses).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(licenses.id, licenseId));
    expect((await workspaceAccess(workspaceId, userId)).mode).toBe('locked');

    // Seats cannot be assigned on an invalid license at all.
    await expect(assignSeat({ workspaceId, licenseId, userId: newId() })).rejects.toThrow(/expired/);
  });
});
