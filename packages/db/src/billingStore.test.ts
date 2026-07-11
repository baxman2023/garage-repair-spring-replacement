import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { hasGenomeFeedEntitlement } from './harvest.js';
import { assignSeat, workspaceAccess } from './licenseStore.js';
import {
  listReceipts,
  processStripeWebhook,
  reapLapsedSubscriptions,
  subscriptionStatus,
  type StripeEventPayload,
} from './billingStore.js';
import { licenses, subscriptions } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[billingStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const evt = (id: string, type: string, object: Record<string, unknown>): StripeEventPayload => ({
  id, type, data: { object },
});

describe('Stripe billing (WO-051)', () => {
  it('ACCEPTANCE: purchase → activation path, and webhook replay is a no-op', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const userId = newId();
    const eventId = `evt_${newId()}`;

    const checkout = evt(eventId, 'checkout.session.completed', {
      id: 'cs_test_1',
      payment_intent: `pi_${eventId}`,
      amount_total: 200_000,
      currency: 'usd',
      metadata: { workspaceId, kind: 'license', seats: '2' },
    });

    const first = await processStripeWebhook(checkout);
    expect(first).toEqual({ replayed: false, applied: 'license issued (2 seats)' });

    // The license landed BOUND to the purchasing workspace with 2 seats…
    const rows = await tenantDb(workspaceId).findMany(licenses, undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seats).toBe(2);
    expect(rows[0]!.status).toBe('active');
    expect(rows[0]!.stripePaymentIntentId).toBe(`pi_${eventId}`);

    // …seats assign and the buyer authenticates (full activation path).
    await assignSeat({ workspaceId, licenseId: rows[0]!.id, userId });
    expect((await workspaceAccess(workspaceId, userId)).mode).toBe('full');

    // Receipt surfaced with the $2,000 amount.
    const receipts = await listReceipts(workspaceId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.amountCents).toBe(200_000);
    expect(receipts[0]!.description).toContain('2 seats');

    // ACCEPTANCE: replaying the exact delivery changes NOTHING.
    const replay = await processStripeWebhook(checkout);
    expect(replay.replayed).toBe(true);
    expect(await tenantDb(workspaceId).findMany(licenses, undefined)).toHaveLength(1);
    expect(await listReceipts(workspaceId)).toHaveLength(1);
  });

  it('subscription lifecycle: created → entitlement on; deleted/lapsed → off within a day', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const subId = `sub_${newId()}`;

    await processStripeWebhook(
      evt(`evt_${newId()}`, 'customer.subscription.created', {
        id: subId,
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
        metadata: { workspaceId },
      }),
    );
    expect(await hasGenomeFeedEntitlement(workspaceId)).toBe(true);
    expect((await subscriptionStatus(workspaceId)).genomeFeed).toBe(true);

    // Invoice → receipt with hosted URL.
    await processStripeWebhook(
      evt(`evt_${newId()}`, 'invoice.paid', {
        id: `in_${newId()}`,
        subscription: subId,
        amount_paid: 7_900,
        currency: 'usd',
        hosted_invoice_url: 'https://invoice.stripe.com/i/test',
      }),
    );
    const receipts = await listReceipts(workspaceId);
    expect(receipts[0]!.kind).toBe('subscription');
    expect(receipts[0]!.url).toContain('invoice.stripe.com');

    // Cancellation flips the entitlement immediately.
    await processStripeWebhook(
      evt(`evt_${newId()}`, 'customer.subscription.deleted', { id: subId, status: 'canceled' }),
    );
    expect(await hasGenomeFeedEntitlement(workspaceId)).toBe(false);

    // Safety net: an active subscription whose period lapsed (webhook missed)
    // is reaped by the 15-minute sweep — well within a day.
    await getDb()
      .update(subscriptions)
      .set({ status: 'active', currentPeriodEnd: new Date(Date.now() - 3_600_000) })
      .where(eq(subscriptions.stripeSubscriptionId, subId));
    expect(await hasGenomeFeedEntitlement(workspaceId)).toBe(true);
    expect(await reapLapsedSubscriptions()).toBeGreaterThanOrEqual(1);
    expect(await hasGenomeFeedEntitlement(workspaceId)).toBe(false);
  });

  it('refund revokes the license with a grace period, receipt says so', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const pi = `pi_${newId()}`;

    await processStripeWebhook(
      evt(`evt_${newId()}`, 'checkout.session.completed', {
        id: 'cs_test_2', payment_intent: pi, amount_total: 100_000, currency: 'usd',
        metadata: { workspaceId, kind: 'license', seats: '1' },
      }),
    );
    await processStripeWebhook(
      evt(`evt_${newId()}`, 'charge.refunded', {
        id: `ch_${newId()}`, payment_intent: pi, amount_refunded: 100_000, currency: 'usd',
      }),
    );

    const [license] = await tenantDb(workspaceId).findMany(licenses, undefined);
    expect(license!.expiresAt).not.toBeNull();
    const daysLeft = (license!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(6);
    expect(daysLeft).toBeLessThanOrEqual(7.1); // the 7-day grace window
    expect(license!.status).toBe('active'); // still usable during grace

    const receipts = await listReceipts(workspaceId);
    expect(receipts.some((r) => r.kind === 'refund' && r.description.includes('grace'))).toBe(true);
  });

  it('unknown event types are recorded and ignored (still replay-safe)', async () => {
    if (!dbUp) return;
    const e = evt(`evt_${newId()}`, 'customer.updated', { id: 'cus_1' });
    expect((await processStripeWebhook(e)).applied).toContain('unhandled');
    expect((await processStripeWebhook(e)).replayed).toBe(true);
  });
});
