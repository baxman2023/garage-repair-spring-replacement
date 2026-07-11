import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { env } from '@copyforge/core';
import { getDb } from '@copyforge/db';

/** Uptime/health endpoint for PM2 and load balancers (WO-056). */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, app: env.APP_NAME, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, error: 'database unreachable' }, { status: 503 });
  }
}
