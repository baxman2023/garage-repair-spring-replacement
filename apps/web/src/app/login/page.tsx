import Link from 'next/link';
import { LoginForm } from './LoginForm';

const ERRORS: Record<string, string> = {
  missing: 'That sign-in link was missing its token. Sign in with your email and password instead.',
  invalid: 'That sign-in link is invalid, expired, or already used. Sign in with your email and password instead.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? ERRORS[sp.error] : undefined;
  return (
    <main>
      <h1>Sign in</h1>
      {error && <p style={{ color: 'salmon' }}>{error}</p>}
      <LoginForm next={sp.next} />
      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/">← Back</Link>
      </p>
    </main>
  );
}
