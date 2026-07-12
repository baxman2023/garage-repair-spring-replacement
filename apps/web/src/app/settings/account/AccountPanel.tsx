'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

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
    <section className="card">
      <h2>Change password</h2>
      <p className="muted small">
        If your account predates password login, leave “current password” blank to set one.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          changePassword.mutate({ currentPassword, newPassword });
        }}
        className="stack"
        style={{ maxWidth: 360, gap: '0.85rem' }}
      >
        <div className="field">
          <label htmlFor="current">Current password</label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="input"
          />
        </div>
        <div className="field">
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
            className="input"
          />
        </div>
        <button type="submit" disabled={changePassword.isPending} className="btn btn-primary">
          {changePassword.isPending ? 'Saving…' : 'Update password'}
        </button>
        {changePassword.isSuccess && <p className="alert alert-ok" style={{ margin: 0 }}>Password updated.</p>}
        {changePassword.isError && (
          <p className="alert alert-danger" style={{ margin: 0 }}>{changePassword.error.message}</p>
        )}
      </form>
    </section>
  );
}
