'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('');
  const requestLink = trpc.auth.requestLink.useMutation();

  if (requestLink.isSuccess) {
    return (
      <p style={{ color: 'var(--ok)' }}>
        Check your email — we sent a sign-in link to <code>{email}</code>. It expires in 15
        minutes.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        requestLink.mutate({ email, next });
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 360 }}
    >
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={{ padding: '0.6rem', borderRadius: 6, border: '1px solid #333', background: '#12151c', color: 'var(--fg)' }}
      />
      <button
        type="submit"
        disabled={requestLink.isPending}
        style={{ padding: '0.6rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#04122e', fontWeight: 600, cursor: 'pointer' }}
      >
        {requestLink.isPending ? 'Sending…' : 'Send magic link'}
      </button>
      {requestLink.isError && <p style={{ color: 'salmon' }}>{requestLink.error.message}</p>}
    </form>
  );
}
