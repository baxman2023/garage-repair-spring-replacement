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
    <main style={{ maxWidth: 400, paddingTop: '4.5rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <p className="eyebrow">Welcome back</p>
        <h1 style={{ margin: '0.4rem 0 0.3rem' }}>Sign in to CopyForge</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Direct-response funnels, forged from your offer.
        </p>
      </div>
      {error && <p className="alert alert-warn">{error}</p>}
      <div className="card" style={{ padding: '1.5rem' }}>
        <LoginForm next={sp.next} />
      </div>
    </main>
  );
}
