'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const inputStyle = {
  padding: '0.6rem',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;

export function AccountPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
    },
  });

  return (
    <section>
      <h2>Change password</h2>
      <p style={{ color: 'var(--muted)' }}>
        If your account predates password login, leave “current password” blank to set one.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          changePassword.mutate({ currentPassword, newPassword });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 360 }}
      >
        <label htmlFor="current">Current password</label>
        <input
          id="current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          style={inputStyle}
        />
        <label htmlFor="new">New password</label>
        <input
          id="new"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={changePassword.isPending}
          style={{ padding: '0.6rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#04122e', fontWeight: 600, cursor: 'pointer' }}
        >
          {changePassword.isPending ? 'Saving…' : 'Update password'}
        </button>
        {changePassword.isSuccess && <p style={{ color: 'var(--ok)', margin: 0 }}>Password updated.</p>}
        {changePassword.isError && (
          <p style={{ color: 'salmon', margin: 0 }}>{changePassword.error.message}</p>
        )}
      </form>
    </section>
  );
}
