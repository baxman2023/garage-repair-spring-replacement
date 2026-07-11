import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loginWithPassword } from '@/server/auth/service';
import { SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/cookies';
import { SESSION_TTL_MS } from '@/server/auth/tokens';
import { allowAuthAttempt } from '@/server/auth/authRateLimit';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Email + password login: verify credentials, mint the session cookie. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!allowAuthAttempt(req, 'login')) {
    return NextResponse.json(
      { error: 'Too many attempts — wait a minute and try again.' },
      { status: 429 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }
  const result = await loginWithPassword(parsed.data.email, parsed.data.password);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, result.rawSessionToken, sessionCookieOptions(SESSION_TTL_MS));
  return res;
}
