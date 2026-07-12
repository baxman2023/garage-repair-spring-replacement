'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/trpc/react';

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const invite = trpc.workspace.invite.useMutation({
    onSuccess: () => {
      setEmail('');
      router.refresh();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        invite.mutate({ email, role });
      }}
      className="row"
    >
      <input
        type="email"
        required
        placeholder="teammate@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input"
        style={{ minWidth: 240 }}
      />
      <select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'member')} className="select">
        <option value="member">member</option>
        <option value="owner">owner</option>
      </select>
      <button type="submit" disabled={invite.isPending} className="btn btn-primary">
        {invite.isPending ? 'Inviting…' : 'Invite'}
      </button>
      {invite.isSuccess && <span className="ok small">Invite sent.</span>}
      {invite.isError && <span className="danger small">{invite.error.message}</span>}
    </form>
  );
}
