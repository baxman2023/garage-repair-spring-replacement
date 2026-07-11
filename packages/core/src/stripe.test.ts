import { describe, expect, it } from 'vitest';
import {
  buildGenomeFeedCheckoutParams,
  buildLicenseCheckoutParams,
  encodeStripeForm,
  parseStripeSignatureHeader,
  signStripePayload,
  verifyStripeSignature,
} from './stripe.js';

const SECRET = 'whsec_test_secret';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

describe('Stripe signature verification (WO-051)', () => {
  it('accepts a correctly signed payload and rejects tampering', () => {
    const header = signStripePayload(PAYLOAD, SECRET);
    expect(verifyStripeSignature({ payload: PAYLOAD, header, secret: SECRET })).toBe(true);
    expect(verifyStripeSignature({ payload: PAYLOAD + 'x', header, secret: SECRET })).toBe(false);
    expect(verifyStripeSignature({ payload: PAYLOAD, header, secret: 'whsec_other' })).toBe(false);
    expect(verifyStripeSignature({ payload: PAYLOAD, header: 'garbage', secret: SECRET })).toBe(false);
  });

  it('rejects stale timestamps outside the tolerance window', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const header = signStripePayload(PAYLOAD, SECRET, old);
    expect(verifyStripeSignature({ payload: PAYLOAD, header, secret: SECRET })).toBe(false);
    expect(
      verifyStripeSignature({ payload: PAYLOAD, header, secret: SECRET, now: old }),
    ).toBe(true);
  });

  it('parses multi-signature headers (key rotation)', () => {
    const good = signStripePayload(PAYLOAD, SECRET);
    const { timestamp, signatures } = parseStripeSignatureHeader(good)!;
    const rotated = `t=${timestamp},v1=${'0'.repeat(64)},v1=${signatures[0]}`;
    expect(verifyStripeSignature({ payload: PAYLOAD, header: rotated, secret: SECRET })).toBe(true);
  });
});

describe('checkout builders (WO-051)', () => {
  it('license checkout: quantity = seats, metadata carries the workspace', () => {
    const params = buildLicenseCheckoutParams({
      workspaceId: 'ws1', seats: 3, priceId: 'price_lic', appUrl: 'https://app.example.com',
    });
    expect(params.mode).toBe('payment');
    expect(params['line_items[0][quantity]']).toBe('3');
    expect(params['metadata[workspaceId]']).toBe('ws1');
    expect(params['metadata[kind]']).toBe('license');
    expect(params['payment_intent_data[metadata][workspaceId]']).toBe('ws1');
    expect(params.success_url).toContain('/settings/billing');
    expect(() =>
      buildLicenseCheckoutParams({ workspaceId: 'w', seats: 0, priceId: 'p', appUrl: 'https://x.co' }),
    ).toThrow(/between 1 and 100/);
  });

  it('genome feed checkout is a subscription with workspace metadata', () => {
    const params = buildGenomeFeedCheckoutParams({
      workspaceId: 'ws1', priceId: 'price_feed', appUrl: 'https://app.example.com',
    });
    expect(params.mode).toBe('subscription');
    expect(params['subscription_data[metadata][workspaceId]']).toBe('ws1');
  });

  it('form encoding round-trips bracketed keys', () => {
    const encoded = encodeStripeForm({ 'line_items[0][price]': 'price_1', mode: 'payment' });
    expect(encoded).toContain('line_items%5B0%5D%5Bprice%5D=price_1');
    expect(encoded).toContain('mode=payment');
  });
});
