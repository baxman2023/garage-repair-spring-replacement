import { NextResponse } from 'next/server';

/**
 * Public quiz API CORS (WO-040): single-file embeds run from file:// and
 * third-party origins, so these endpoints answer any origin. They expose no
 * tenant data beyond the public quiz view and accept only quiz interactions.
 */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export function corsJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export function corsOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
