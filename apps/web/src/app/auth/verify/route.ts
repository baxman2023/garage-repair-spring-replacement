import { type NextRequest, NextResponse } from 'next/server';
import { verifyMagicLink } from '@/server/auth/service';
import { SESSION_COOKIE, safeNextPath, sessionCookieOptions } from '@/server/auth/cookies';
import { SESSION_TTL_MS } from '@/server/auth/tokens';

/** Magic-link landing: verify token, mint session cookie, redirect into the app. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing', req.url));
  }
  const result = await verifyMagicLink(token);
  if (!result) {
    return NextResponse.redirect(new URL('/login?error=invalid', req.url));
  }
  const next = safeNextPath(req.nextUrl.searchParams.get('next'));
  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(SESSION_COOKIE, result.rawSessionToken, sessionCookieOptions(SESSION_TTL_MS));
  return res;
}
