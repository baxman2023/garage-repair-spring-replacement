import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ingestPixelEvent, ingestRingbaEvent, resolveIngestKey } from '@copyforge/db';

/**
 * Public ingestion adapters (WO-043): POST /api/ingest/<key>/<ringba|pixel>.
 * The per-project ingest key IS the authentication. Replay-safe (dedupe keys
 * collapse duplicates); unmapped/malformed deliveries land in triage with a
 * 202 — the sender should not retry what we have safely parked.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ key: string; adapter: string }> },
) {
  const { key, adapter } = await ctx.params;
  const scope = await resolveIngestKey(key);
  if (!scope) return NextResponse.json({ error: 'Unknown ingest key.' }, { status: 401, headers: CORS });

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400, headers: CORS });

  if (adapter === 'ringba') {
    const result = await ingestRingbaEvent(scope, payload);
    return NextResponse.json(result, { status: result.outcome === 'triaged' ? 202 : 200, headers: CORS });
  }
  if (adapter === 'pixel') {
    const result = await ingestPixelEvent(scope, payload);
    return NextResponse.json(result, { status: result.outcome === 'triaged' ? 202 : 200, headers: CORS });
  }
  return NextResponse.json({ error: `Unknown adapter "${adapter}" (ringba|pixel).` }, { status: 404, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
