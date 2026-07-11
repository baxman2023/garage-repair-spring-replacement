import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { lookupUtmVariant } from '@copyforge/db';

/**
 * Message-match middleware (WO-041, public): resolve utm_content → variant.
 * One indexed lookup — fast enough for the sub-50ms swap budget. Unmapped
 * returns {} so the snippet falls back to control cleanly.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'public, max-age=60',
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  const utmContent = req.nextUrl.searchParams.get('utm_content') ?? '';
  if (!/^[0-9A-Za-z]{26}$/.test(assetId) || !utmContent) {
    return NextResponse.json({}, { status: 200, headers: CORS });
  }
  const variant = await lookupUtmVariant(assetId, utmContent);
  return NextResponse.json(variant ?? {}, { status: 200, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
