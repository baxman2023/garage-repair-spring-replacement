'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/trpc/react';

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
    <div className="stack">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name });
        }}
        className="row"
      >
        <input
          placeholder="New project name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input"
          style={{ minWidth: 280, flex: 1 }}
        />
        <button type="submit" disabled={create.isPending} className="btn btn-primary">
          {create.isPending ? 'Creating…' : 'Create project'}
        </button>
      </form>
      {create.isError && <p className="alert alert-danger">{create.error.message}</p>}

      <ul className="plain stack-sm">
        {list.data?.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="card-row"
              style={{ color: 'var(--fg)', textDecoration: 'none' }}
            >
              <span style={{ fontWeight: 550 }}>{p.name}</span>
              <span className="badge">{p.status}</span>
            </Link>
          </li>
        ))}
        {list.data?.length === 0 && (
          <li className="card muted">
            No projects yet — create your first one above, skim the{' '}
            <a href="/docs/getting-started">first-funnel guide</a>, or study the{' '}
            <a href="/demo">read-only sample build</a> first.
          </li>
        )}
      </ul>
    </div>
  );
}
