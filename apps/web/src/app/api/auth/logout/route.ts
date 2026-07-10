import { type NextRequest, NextResponse } from 'next/server';
import { destroySession } from '@/server/auth/service';
import { SESSION_COOKIE, parseCookieHeader, sessionCookieOptions } from '@/server/auth/cookies';

/** Destroy the session server-side and clear the cookie. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const raw = cookies[SESSION_COOKIE];
  if (raw) await destroySession(raw);
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
  return res;
}
