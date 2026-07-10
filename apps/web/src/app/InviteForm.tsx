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
      style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}
    >
      <input
        type="email"
        required
        placeholder="teammate@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #333', background: '#12151c', color: 'var(--fg)' }}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as 'owner' | 'member')}
        style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #333', background: '#12151c', color: 'var(--fg)' }}
      >
        <option value="member">member</option>
        <option value="owner">owner</option>
      </select>
      <button
        type="submit"
        disabled={invite.isPending}
        style={{ padding: '0.5rem 0.9rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#04122e', fontWeight: 600, cursor: 'pointer' }}
      >
        {invite.isPending ? 'Inviting…' : 'Invite'}
      </button>
      {invite.isSuccess && <span style={{ color: 'var(--ok)' }}>Invite sent.</span>}
      {invite.isError && <span style={{ color: 'salmon' }}>{invite.error.message}</span>}
    </form>
  );
}
