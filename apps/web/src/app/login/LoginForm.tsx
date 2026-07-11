'use client';

import { useState } from 'react';

const inputStyle = {
  padding: '0.6rem',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;

/** Same-origin relative paths only (mirrors server-side safeNextPath). */
function safeNext(next?: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'register' ? { email, password, name: name || undefined } : { email, password },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong — try again.');
        setPending(false);
        return;
      }
      window.location.assign(safeNext(next));
    } catch {
      setError('Network error — try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 360 }}>
      {mode === 'register' && (
        <>
          <label htmlFor="name">Name (optional)</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={inputStyle}
          />
        </>
      )}
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={inputStyle}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        required
        minLength={mode === 'register' ? 8 : 1}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
        style={inputStyle}
      />
      <button
        type="submit"
        disabled={pending}
        style={{ padding: '0.6rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#04122e', fontWeight: 600, cursor: 'pointer' }}
      >
        {pending ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {error && <p style={{ color: 'salmon', margin: 0 }}>{error}</p>}
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
        >
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </form>
  );
}
