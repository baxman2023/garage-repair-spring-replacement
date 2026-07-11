'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.5rem',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
};
const btn = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
};

export function ProjectsPanel() {
  const utils = trpc.useUtils();
  const list = trpc.projects.list.useQuery();
  const [name, setName] = useState('');
  const create = trpc.projects.create.useMutation({
    onSuccess: () => {
      setName('');
      void utils.projects.list.invalidate();
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name });
        }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input
          placeholder="New project name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ ...box, minWidth: 280 }}
        />
        <button type="submit" disabled={create.isPending} style={btn}>
          {create.isPending ? 'Creating…' : 'Create project'}
        </button>
      </form>
      {create.isError && <p style={{ color: 'salmon' }}>{create.error.message}</p>}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {list.data?.map((p) => (
          <li key={p.id} style={{ ...box, display: 'flex', justifyContent: 'space-between' }}>
            <Link href={`/projects/${p.id}`}>{p.name}</Link>
            <span style={{ color: 'var(--muted)' }}>{p.status}</span>
          </li>
        ))}
        {list.data?.length === 0 && (
          <li style={{ color: 'var(--muted)' }}>
            No projects yet — create your first one above, skim the{' '}
            <a href="/docs/getting-started">first-funnel guide</a>, or study the{' '}
            <a href="/demo">read-only sample build</a> first.
          </li>
        )}
      </ul>
    </div>
  );
}
