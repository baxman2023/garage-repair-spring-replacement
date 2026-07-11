import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure Stripe helpers (WO-051): webhook signature verification and checkout
 * parameter builders. No HTTP here — the web app supplies the fetch; tests
 * exercise these against fixture payloads with zero network.
 */

export interface StripeSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/** Parse Stripe's `Stripe-Signature` header (`t=…,v1=…[,v1=…]`). */
export function parseStripeSignatureHeader(header: string): StripeSignatureHeader | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === 't') timestamp = Number(value);
    if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function stripeSignaturePayload(timestamp: number, payload: string): string {
  return `${timestamp}.${payload}`;
}

/** Verify a webhook delivery: HMAC-SHA256 over `t.payload`, ±tolerance. */
export function verifyStripeSignature(params: {
  payload: string;
  header: string;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): boolean {
  const parsed = parseStripeSignatureHeader(params.header);
  if (!parsed) return false;
  const tolerance = params.toleranceSeconds ?? 300;
  const nowSec = Math.floor((params.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > tolerance) return false;

  const expected = createHmac('sha256', params.secret)
    .update(stripeSignaturePayload(parsed.timestamp, params.payload))
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return parsed.signatures.some((sig) => {
    const buf = Buffer.from(sig, 'hex');
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
}

/** Sign a payload the way Stripe does — for tests and local simulation. */
export function signStripePayload(payload: string, secret: string, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(stripeSignaturePayload(t, payload)).digest('hex');
  return `t=${t},v1=${v1}`;
}

// --- Checkout session builders -----------------------------------------------------

export interface CheckoutParams {
  [key: string]: string;
}

/** $1,000 lifetime license — quantity = seats (spec §5). */
export function buildLicenseCheckoutParams(opts: {
  workspaceId: string;
  seats: number;
  priceId: string;
  appUrl: string;
}): CheckoutParams {
  if (!Number.isInteger(opts.seats) || opts.seats < 1 || opts.seats > 100) {
    throw new Error('Seats must be an integer between 1 and 100.');
  }
  return {
    mode: 'payment',
    'line_items[0][price]': opts.priceId,
    'line_items[0][quantity]': String(opts.seats),
    'metadata[workspaceId]': opts.workspaceId,
    'metadata[kind]': 'license',
    'metadata[seats]': String(opts.seats),
    'payment_intent_data[metadata][workspaceId]': opts.workspaceId,
    'payment_intent_data[metadata][kind]': 'license',
    success_url: `${opts.appUrl}/settings/billing?status=success`,
    cancel_url: `${opts.appUrl}/settings/billing?status=cancelled`,
  };
}

/** Genome Feed subscription — $79/mo entitlement (spec §5). */
export function buildGenomeFeedCheckoutParams(opts: {
  workspaceId: string;
  priceId: string;
  appUrl: string;
}): CheckoutParams {
  return {
    mode: 'subscription',
    'line_items[0][price]': opts.priceId,
    'line_items[0][quantity]': '1',
    'metadata[workspaceId]': opts.workspaceId,
    'metadata[kind]': 'genome_feed',
    'subscription_data[metadata][workspaceId]': opts.workspaceId,
    success_url: `${opts.appUrl}/settings/billing?status=success`,
    cancel_url: `${opts.appUrl}/settings/billing?status=cancelled`,
  };
}

export function encodeStripeForm(params: CheckoutParams): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
