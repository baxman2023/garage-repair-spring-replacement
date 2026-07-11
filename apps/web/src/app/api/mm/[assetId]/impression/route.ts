import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { recordVariantImpression } from '@copyforge/db';

/** Variant impressions → ledger (WO-041, public, replay-safe). */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    utm_content?: string;
    matched?: boolean;
    ref?: string;
  } | null;
  if (!/^[0-9A-Za-z]{26}$/.test(assetId) || !body?.utm_content || !body.ref) {
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS });
  }
  const ok = await recordVariantImpression({
    assetId,
    utmContent: body.utm_content,
    matched: Boolean(body.matched),
    ref: body.ref.slice(0, 48),
  });
  return NextResponse.json({ ok }, { status: 200, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
