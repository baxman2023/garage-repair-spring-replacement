import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { issueLicense } from './licenseStore.js';
import { billingReceipts, licenses, stripeEvents, subscriptions } from './schema/index.js';

/**
 * Stripe billing (WO-051): money in, entitlements on.
 *
 * All state changes flow through `processStripeWebhook`, idempotent via the
 * unique `stripe_events.stripe_event_id` — a replayed delivery records
 * nothing twice and re-applies nothing. Checkout sessions carry
 * `metadata.workspaceId`, so every event self-locates its tenant.
 */

export const REFUND_GRACE_DAYS = 7;

export interface StripeEventPayload {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface WebhookOutcome {
  replayed: boolean;
  applied: string;
}

/** Record the event id; false = we have seen this delivery before. */
async function recordStripeEvent(event: StripeEventPayload): Promise<boolean> {
  try {
    await getDb().insert(stripeEvents).values({
      id: newId(),
      stripeEventId: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
    return true;
  } catch (err) {
    if (err instanceof Error && /Duplicate entry|ER_DUP_ENTRY/i.test(err.message)) return false;
    throw err;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

async function addReceipt(params: {
  workspaceId: string;
  kind: 'license' | 'subscription' | 'refund';
  stripeRef: string;
  amountCents: number;
  currency: string;
  description: string;
  url?: string | null;
}): Promise<void> {
  await tenantDb(params.workspaceId).insert(billingReceipts, {
    kind: params.kind,
    stripeRef: params.stripeRef,
    amountCents: params.amountCents,
    currency: params.currency || 'usd',
    description: params.description,
    url: params.url ?? null,
  });
}

async function applyCheckoutCompleted(obj: Record<string, unknown>): Promise<string> {
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const workspaceId = str(metadata.workspaceId);
  const kind = str(metadata.kind);
  if (!workspaceId) return 'ignored: no workspaceId metadata';

  if (kind === 'license') {
    const seats = Math.max(1, Math.trunc(Number(metadata.seats) || 1));
    const paymentIntentId = str(obj.payment_intent);
    const { licenseId, key } = await issueLicense({ seats, workspaceId });
    if (paymentIntentId) {
      await getDb()
        .update(licenses)
        .set({ stripePaymentIntentId: paymentIntentId })
        .where(eq(licenses.id, licenseId));
    }
    await addReceipt({
      workspaceId,
      kind: 'license',
      stripeRef: paymentIntentId || str(obj.id),
      amountCents: num(obj.amount_total),
      currency: str(obj.currency) || 'usd',
      description: `CopyForge lifetime license — ${seats} seat${seats === 1 ? '' : 's'} (key ${key.slice(0, 8)}…)`,
    });
    return `license issued (${seats} seats)`;
  }
  return `ignored: checkout kind "${kind || 'unknown'}"`;
}

async function applySubscriptionEvent(
  obj: Record<string, unknown>,
  deleted: boolean,
): Promise<string> {
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const workspaceId = str(metadata.workspaceId);
  const subscriptionId = str(obj.id);
  if (!subscriptionId) return 'ignored: no subscription id';

  const stripeStatus = str(obj.status);
  const active = !deleted && (stripeStatus === 'active' || stripeStatus === 'trialing');
  const periodEnd = num(obj.current_period_end);

  const existing = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (existing[0]) {
    await getDb()
      .update(subscriptions)
      .set({
        status: active ? 'active' : 'inactive',
        genomeFeed: true,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : existing[0].currentPeriodEnd,
      })
      .where(eq(subscriptions.id, existing[0].id));
    return `subscription ${active ? 'active' : 'inactive'}`;
  }
  if (!workspaceId) return 'ignored: unknown subscription without workspaceId metadata';
  await tenantDb(workspaceId).insert(subscriptions, {
    stripeSubscriptionId: subscriptionId,
    genomeFeed: true,
    status: active ? 'active' : 'inactive',
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
  });
  return `subscription created (${active ? 'active' : 'inactive'})`;
}

async function applyInvoicePaid(obj: Record<string, unknown>): Promise<string> {
  const subscriptionId = str(obj.subscription);
  if (!subscriptionId) return 'ignored: invoice without subscription';
  const rows = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);
  const sub = rows[0];
  if (!sub) return 'ignored: invoice for unknown subscription';
  await addReceipt({
    workspaceId: sub.workspaceId,
    kind: 'subscription',
    stripeRef: str(obj.id),
    amountCents: num(obj.amount_paid),
    currency: str(obj.currency) || 'usd',
    description: 'Genome Feed subscription',
    url: str(obj.hosted_invoice_url) || null,
  });
  return 'invoice receipt recorded';
}

/** Refund → revoke with grace: the license expires REFUND_GRACE_DAYS out. */
async function applyChargeRefunded(obj: Record<string, unknown>, now: Date): Promise<string> {
  const paymentIntentId = str(obj.payment_intent);
  if (!paymentIntentId) return 'ignored: refund without payment_intent';
  const rows = await getDb()
    .select()
    .from(licenses)
    .where(eq(licenses.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  const license = rows[0];
  if (!license || !license.workspaceId) return 'ignored: refund for unknown license';

  const graceEnd = new Date(now.getTime() + REFUND_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expiresAt =
    license.expiresAt && license.expiresAt.getTime() < graceEnd.getTime()
      ? license.expiresAt
      : graceEnd;
  await getDb().update(licenses).set({ expiresAt }).where(eq(licenses.id, license.id));
  await addReceipt({
    workspaceId: license.workspaceId,
    kind: 'refund',
    stripeRef: str(obj.id) || paymentIntentId,
    amountCents: num(obj.amount_refunded),
    currency: str(obj.currency) || 'usd',
    description: `Refund processed — license access ends ${graceEnd.toISOString().slice(0, 10)} (${REFUND_GRACE_DAYS}-day grace).`,
  });
  return `license grace-revoked (expires ${graceEnd.toISOString().slice(0, 10)})`;
}

/** The idempotent webhook entrypoint. */
export async function processStripeWebhook(
  event: StripeEventPayload,
  now = new Date(),
): Promise<WebhookOutcome> {
  const fresh = await recordStripeEvent(event);
  if (!fresh) return { replayed: true, applied: 'none (already processed)' };

  const obj = event.data?.object ?? {};
  let applied: string;
  switch (event.type) {
    case 'checkout.session.completed':
      applied = await applyCheckoutCompleted(obj);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      applied = await applySubscriptionEvent(obj, false);
      break;
    case 'customer.subscription.deleted':
      applied = await applySubscriptionEvent(obj, true);
      break;
    case 'invoice.paid':
      applied = await applyInvoicePaid(obj);
      break;
    case 'charge.refunded':
      applied = await applyChargeRefunded(obj, now);
      break;
    default:
      applied = `ignored: unhandled type ${event.type}`;
  }
  await getDb()
    .update(stripeEvents)
    .set({ processedAt: now })
    .where(eq(stripeEvents.stripeEventId, event.id));
  return { replayed: false, applied };
}

/**
 * Safety net for missed webhooks: any subscription still `active` past its
 * period end flips inactive. The worker sweeps every 15 minutes, so a lapse
 * flips the entitlement well within a day even if Stripe never reaches us.
 */
export async function reapLapsedSubscriptions(now = new Date()): Promise<number> {
  const rows = await getDb()
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, 'active'),
        isNotNull(subscriptions.currentPeriodEnd),
        lt(subscriptions.currentPeriodEnd, now),
      ),
    );
  for (const row of rows) {
    await getDb().update(subscriptions).set({ status: 'inactive' }).where(eq(subscriptions.id, row.id));
  }
  return rows.length;
}

export async function listReceipts(workspaceId: string) {
  const rows = await tenantDb(workspaceId).findMany(billingReceipts, undefined);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}

export async function subscriptionStatus(workspaceId: string) {
  const rows = await tenantDb(workspaceId).findMany(subscriptions, undefined);
  const active = rows.find((r) => r.status === 'active' && r.genomeFeed);
  return {
    genomeFeed: Boolean(active),
    currentPeriodEnd: active?.currentPeriodEnd ?? null,
  };
}
