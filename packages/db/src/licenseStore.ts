import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { licenses, seatAssignments, users, workspaceMembers, type LicenseType } from './schema/index.js';

/**
 * Licensing & seats (WO-050): $1,000/user enforced structurally.
 *
 * Lifecycle: issue (unbound key) → activate (binds to a workspace) → assign
 * named seats up to the license's seat count → revoke. Access enforcement is
 * `workspaceAccess`: no seat on a licensed workspace = locked out with the
 * upsell message; a seat only on an EXPIRED beta (Forge Vault) license
 * degrades to read-only instead of lockout.
 */

export const SEAT_PRICE_USD = 1_000;

export const UPSELL_MESSAGE =
  `No licensed seat is assigned to your account in this workspace. ` +
  `CopyForge is licensed per named user at $${SEAT_PRICE_USD.toLocaleString('en-US')} per seat — ` +
  `ask a workspace owner to assign you a seat or purchase another.`;

export const SEATS_FULL_MESSAGE = (seats: number): string =>
  `All ${seats} seat${seats === 1 ? '' : 's'} on this license are taken. ` +
  `CopyForge is $${SEAT_PRICE_USD.toLocaleString('en-US')} per named user — purchase more seats to add teammates.`;

export const BETA_EXPIRED_MESSAGE =
  'Your Forge Vault beta license has expired. The workspace is read-only — ' +
  'existing work stays visible and exportable, but nothing new generates until a full seat is assigned.';

export type LicenseRow = typeof licenses.$inferSelect;

const newLicenseKey = (): string => `lic_${randomBytes(20).toString('hex')}`;

/** Issue a key. Unbound unless `workspaceId` is given (the Stripe path binds directly). */
export async function issueLicense(params: {
  seats: number;
  type?: LicenseType;
  expiresAt?: Date | null;
  workspaceId?: string | null;
}): Promise<{ licenseId: string; key: string }> {
  if (!Number.isInteger(params.seats) || params.seats < 1) {
    throw new Error('A license needs at least one seat.');
  }
  const id = newId();
  const key = newLicenseKey();
  await getDb().insert(licenses).values({
    id,
    workspaceId: params.workspaceId ?? null,
    key,
    status: 'active',
    type: params.type ?? 'standard',
    seats: params.seats,
    expiresAt: params.expiresAt ?? null,
  });
  return { licenseId: id, key };
}

/** Activate a key into a workspace. Idempotent for the same workspace. */
export async function activateLicenseKey(params: {
  workspaceId: string;
  key: string;
}): Promise<LicenseRow> {
  const rows = await getDb().select().from(licenses).where(eq(licenses.key, params.key)).limit(1);
  const row = rows[0];
  if (!row) throw new Error('Unknown license key.');
  if (row.status === 'revoked') throw new Error('This license key has been revoked.');
  if (row.workspaceId && row.workspaceId !== params.workspaceId) {
    throw new Error('This license key is already activated in another workspace.');
  }
  if (!row.workspaceId) {
    await getDb().update(licenses).set({ workspaceId: params.workspaceId }).where(eq(licenses.id, row.id));
    row.workspaceId = params.workspaceId;
  }
  return row;
}

/** Revoke a license (refund path / admin). Seats become inert immediately. */
export async function revokeLicense(licenseId: string): Promise<void> {
  await getDb().update(licenses).set({ status: 'revoked' }).where(eq(licenses.id, licenseId));
}

export async function revokeLicenseByKey(key: string): Promise<void> {
  await getDb().update(licenses).set({ status: 'revoked' }).where(eq(licenses.key, key));
}

/** True when the license row currently grants full access. */
export function licenseValid(row: LicenseRow, now = new Date()): boolean {
  if (row.status !== 'active') return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Lazily stamp expired actives so listings and access agree. */
async function reapExpired(rows: LicenseRow[], now: Date): Promise<void> {
  for (const row of rows) {
    if (row.status === 'active' && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      await getDb().update(licenses).set({ status: 'expired' }).where(eq(licenses.id, row.id));
      row.status = 'expired';
    }
  }
}

// --- Seats -----------------------------------------------------------------------

export async function assignSeat(params: {
  workspaceId: string;
  licenseId: string;
  userId: string;
}): Promise<string> {
  const db = tenantDb(params.workspaceId);
  const license = await db.findFirst(licenses, eq(licenses.id, params.licenseId));
  if (!license) throw new Error('License not found in this workspace.');
  await reapExpired([license], new Date());
  if (!licenseValid(license)) {
    throw new Error(`This license is ${license.status} — seats cannot be assigned on it.`);
  }

  const taken = await db.findMany(seatAssignments, eq(seatAssignments.licenseId, params.licenseId));
  const existing = taken.find((s) => s.userId === params.userId);
  if (existing) return existing.id; // named seat already held — idempotent
  if (taken.length >= license.seats) throw new Error(SEATS_FULL_MESSAGE(license.seats));

  return db.insert(seatAssignments, {
    licenseId: params.licenseId,
    userId: params.userId,
  });
}

export async function unassignSeat(params: {
  workspaceId: string;
  licenseId: string;
  userId: string;
}): Promise<void> {
  await tenantDb(params.workspaceId).delete(
    seatAssignments,
    and(eq(seatAssignments.licenseId, params.licenseId), eq(seatAssignments.userId, params.userId)),
  );
}

// --- Access enforcement ------------------------------------------------------------

export type AccessMode = 'full' | 'readonly' | 'locked';

export interface WorkspaceAccess {
  mode: AccessMode;
  reason: string | null;
}

/**
 * The WO-050 enforcement rule, evaluated per request:
 * - workspace holds NO licenses → full (pre-purchase/trial workspace; WO-051
 *   issues the first license at checkout).
 * - seat on a valid license → full.
 * - seat ONLY on an expired beta (Forge Vault) license → read-only (graceful).
 * - otherwise (no seat, or seats only on revoked/expired-standard licenses)
 *   → locked, with the per-seat upsell message.
 */
export async function workspaceAccess(workspaceId: string, userId: string): Promise<WorkspaceAccess> {
  const db = tenantDb(workspaceId);
  const rows = await db.findMany(licenses, undefined);
  if (rows.length === 0) return { mode: 'full', reason: null };
  const now = new Date();
  await reapExpired(rows, now);

  const seats = (await db.findMany(seatAssignments, eq(seatAssignments.userId, userId))).map(
    (s) => s.licenseId,
  );
  const seated = rows.filter((l) => seats.includes(l.id));

  if (seated.some((l) => licenseValid(l, now))) return { mode: 'full', reason: null };
  if (seated.some((l) => l.type === 'beta' && l.status === 'expired')) {
    return { mode: 'readonly', reason: BETA_EXPIRED_MESSAGE };
  }
  return { mode: 'locked', reason: UPSELL_MESSAGE };
}

// --- Overview (assignment UI) -------------------------------------------------------

export interface LicenseOverview {
  licenses: Array<{
    licenseId: string;
    keyMasked: string;
    type: LicenseType;
    status: string;
    seats: number;
    expiresAt: Date | null;
    valid: boolean;
    assignments: Array<{ userId: string; email: string; name: string | null }>;
  }>;
  members: Array<{ userId: string; email: string; name: string | null; role: string; seated: boolean }>;
}

export async function licenseOverview(workspaceId: string): Promise<LicenseOverview> {
  const db = tenantDb(workspaceId);
  const now = new Date();
  const rows = await db.findMany(licenses, undefined);
  await reapExpired(rows, now);
  const seats = await db.findMany(seatAssignments, undefined);

  const members = await getDb()
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      name: users.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const seatedUsers = new Set(seats.map((s) => s.userId));

  return {
    licenses: rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((l) => ({
        licenseId: l.id,
        keyMasked: `${l.key.slice(0, 8)}…${l.key.slice(-4)}`,
        type: l.type,
        status: l.status,
        seats: l.seats,
        expiresAt: l.expiresAt,
        valid: licenseValid(l, now),
        assignments: seats
          .filter((s) => s.licenseId === l.id)
          .map((s) => {
            const m = memberById.get(s.userId);
            return { userId: s.userId, email: m?.email ?? '(removed user)', name: m?.name ?? null };
          }),
      })),
    members: members.map((m) => ({ ...m, seated: seatedUsers.has(m.userId) })),
  };
}
