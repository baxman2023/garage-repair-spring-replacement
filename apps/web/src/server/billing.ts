import {
  buildGenomeFeedCheckoutParams,
  buildLicenseCheckoutParams,
  encodeStripeForm,
  env,
} from '@copyforge/core';

/**
 * Stripe checkout session creation (WO-051). The only outbound Stripe call in
 * the app; the fetcher is injectable for tests. Requires STRIPE_SECRET_KEY +
 * price ids in the environment — refuses loudly otherwise.
 */

export type StripeFetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function createCheckoutSession(
  opts: { workspaceId: string; kind: 'license' | 'genome_feed'; seats?: number },
  fetcher: StripeFetcher = fetch,
): Promise<{ url: string; sessionId: string }> {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY).');

  let params;
  if (opts.kind === 'license') {
    const priceId = env.STRIPE_PRICE_LICENSE;
    if (!priceId) throw new Error('Stripe is not configured (STRIPE_PRICE_LICENSE).');
    params = buildLicenseCheckoutParams({
      workspaceId: opts.workspaceId,
      seats: opts.seats ?? 1,
      priceId,
      appUrl: env.APP_URL,
    });
  } else {
    const priceId = env.STRIPE_PRICE_GENOME_FEED;
    if (!priceId) throw new Error('Stripe is not configured (STRIPE_PRICE_GENOME_FEED).');
    params = buildGenomeFeedCheckoutParams({
      workspaceId: opts.workspaceId,
      priceId,
      appUrl: env.APP_URL,
    });
  }

  const res = await fetcher('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: encodeStripeForm(params),
  });
  const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.url || !body.id) {
    throw new Error(`Stripe checkout failed: ${body.error?.message ?? `HTTP ${res.status}`}`);
  }
  return { url: body.url, sessionId: body.id };
}
