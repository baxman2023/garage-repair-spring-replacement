import { type NextRequest, NextResponse } from 'next/server';
import { acceptInvite, getSessionContext, setSessionActiveWorkspace } from '@/server/auth/service';
import { SESSION_COOKIE, parseCookieHeader } from '@/server/auth/cookies';

/**
 * Invite landing: requires a session. Accepts the invite, adds membership, and
 * switches the session into the invited workspace. Unauthenticated visitors are
 * bounced to /login with a `next` back to this URL.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing', req.url));
  }

  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const auth = await getSessionContext(cookies[SESSION_COOKIE]);
  if (!auth) {
    const next = encodeURIComponent(`/invite/accept?token=${token}`);
    return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
  }

  const result = await acceptInvite(token, auth.user.id);
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/?invite=${result.reason}`, req.url));
  }
  await setSessionActiveWorkspace(auth.session.id, result.workspaceId);
  return NextResponse.redirect(new URL('/?invite=ok', req.url));
}
