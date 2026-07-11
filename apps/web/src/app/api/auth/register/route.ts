import { NextResponse } from 'next/server';
import { z } from 'zod';
import { registerWithPassword } from '@/server/auth/service';
import { MIN_PASSWORD_LENGTH } from '@/server/auth/password';
import { SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/cookies';
import { SESSION_TTL_MS } from '@/server/auth/tokens';
import { allowAuthAttempt } from '@/server/auth/authRateLimit';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  }),
  name: z.string().max(255).optional(),
});

/** Create an account with email + password, then sign the user straight in. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!allowAuthAttempt(req, 'register')) {
    return NextResponse.json(
      { error: 'Too many attempts — wait a minute and try again.' },
      { status: 429 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Enter a valid email and password.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const result = await registerWithPassword(
    parsed.data.email,
    parsed.data.password,
    parsed.data.name,
  );
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, result.rawSessionToken, sessionCookieOptions(SESSION_TTL_MS));
  return res;
}
