import { NextResponse } from 'next/server';
import { env, verifyStripeSignature } from '@copyforge/core';
import { processStripeWebhook, type StripeEventPayload } from '@copyforge/db';

/**
 * Stripe webhook receiver (WO-051). Raw-body signature verification, then the
 * idempotent processor — replays return 200 without re-applying anything so
 * Stripe stops retrying.
 */

export async function POST(req: Request): Promise<NextResponse> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Stripe webhook not configured.' }, { status: 503 });
  }
  const payload = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';
  if (!verifyStripeSignature({ payload, header: signature, secret })) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let event: StripeEventPayload;
  try {
    event = JSON.parse(payload) as StripeEventPayload;
    if (!event.id || !event.type) throw new Error('missing id/type');
  } catch {
    return NextResponse.json({ error: 'Malformed event payload.' }, { status: 400 });
  }

  const outcome = await processStripeWebhook(event);
  return NextResponse.json({ received: true, ...outcome });
}
