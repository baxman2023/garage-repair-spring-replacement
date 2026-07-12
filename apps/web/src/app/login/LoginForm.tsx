'use client';

import { useState } from 'react';

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
    <form onSubmit={submit} className="stack" style={{ gap: '0.85rem' }}>
      {mode === 'register' && (
        <div className="field">
          <label htmlFor="name">Name (optional)</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="input"
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="input"
        />
      </div>
      <div className="field">
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
          className="input"
        />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary" style={{ marginTop: '0.25rem' }}>
        {pending ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {error && <p className="alert alert-danger" style={{ margin: 0 }}>{error}</p>}
      <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
        {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          style={{ padding: 0, border: 'none', background: 'none', color: 'var(--link)', font: 'inherit', fontWeight: 600 }}
        >
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </form>
  );
}
