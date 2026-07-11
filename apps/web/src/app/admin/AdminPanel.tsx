'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;
const btn = {
  padding: '0.3rem 0.7rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
} as const;
const ghost = { ...btn, background: 'transparent', border: '1px solid #444', color: 'inherit' } as const;
const input = {
  padding: '0.4rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#0b0e14',
  color: 'inherit',
  fontSize: 13,
} as const;
const th = { textAlign: 'left', padding: '0.3rem 0.6rem', color: 'var(--muted)', fontWeight: 400 } as const;
const td = { padding: '0.3rem 0.6rem' } as const;

function SearchSection() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const search = trpc.admin.search.useQuery({ query: submitted }, { enabled: submitted.length > 0 });

  return (
    <section style={box}>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: 16 }}>Search users · workspaces · licenses</h2>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          style={{ ...input, minWidth: 280 }}
          placeholder="email, name, workspace, license key…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSubmitted(query.trim())}
        />
        <button style={btn} onClick={() => setSubmitted(query.trim())}>Search</button>
      </div>
      {search.data && (
        <div style={{ marginTop: '0.6rem', fontSize: 13, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {search.data.users.map((u) => (
            <div key={u.id}>
              user · {u.email} {u.name ? `(${u.name})` : ''} {u.isPlatformAdmin ? '· platform admin' : ''}
            </div>
          ))}
          {search.data.workspaces.map((w) => (
            <div key={w.id}>workspace · {w.name} <code style={{ color: 'var(--muted)' }}>{w.id}</code></div>
          ))}
          {search.data.licenses.map((l) => (
            <div key={l.id}>
              license · <code>{l.keyMasked}</code> · {l.type} · {l.status} · {l.seats} seats
              {l.workspaceId ? '' : ' · unactivated'}
            </div>
          ))}
          {search.data.users.length + search.data.workspaces.length + search.data.licenses.length === 0 && (
            <span style={{ color: 'var(--muted)' }}>No matches.</span>
          )}
        </div>
      )}
    </section>
  );
}

function FlagsSection() {
  const utils = trpc.useUtils();
  const flags = trpc.admin.flags.useQuery(undefined, { refetchInterval: 8000 });
  const invalidate = () => void utils.admin.flags.invalidate();
  const setFlag = trpc.admin.setFlag.useMutation({ onSuccess: invalidate });
  const setPaused = trpc.admin.setPausedJobTypes.useMutation({ onSuccess: invalidate });

  const data = flags.data;
  if (!data) return null;
  const surgical = data.flags.find((f) => f.key === 'paused_job_types');
  const surgicalTypes = surgical?.enabled
    ? ((surgical.value as { types?: string[] } | null)?.types ?? [])
    : [];

  return (
    <section style={box}>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: 16 }}>Feature flags & kill switches</h2>
      {data.flags
        .filter((f) => f.key !== 'paused_job_types')
        .map((f) => (
          <div key={f.key} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: 13, marginBottom: '0.3rem' }}>
            <button
              style={f.enabled ? btn : ghost}
              disabled={setFlag.isPending}
              onClick={() => setFlag.mutate({ key: f.key, enabled: !f.enabled })}
            >
              {f.enabled ? 'ON' : 'OFF'}
            </button>
            <code>{f.key}</code>
            <span style={{ color: 'var(--muted)' }}>{f.description}</span>
          </div>
        ))}

      <h3 style={{ margin: '0.8rem 0 0.4rem', fontSize: 14 }}>Paused job types</h3>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 0.4rem' }}>
        Effective pause set (incl. the generation master switch):{' '}
        {data.pausedJobTypes.length ? data.pausedJobTypes.join(', ') : 'none'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
        {data.knownJobTypes.map((t) => {
          const paused = surgicalTypes.includes(t);
          return (
            <button
              key={t}
              style={paused ? { ...btn, background: 'salmon' } : ghost}
              disabled={setPaused.isPending}
              onClick={() =>
                setPaused.mutate({
                  types: paused ? surgicalTypes.filter((x) => x !== t) : [...surgicalTypes, t],
                })
              }
            >
              {t}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ModelRoutesSection() {
  const utils = trpc.useUtils();
  const routes = trpc.admin.modelRoutes.useQuery();
  const update = trpc.admin.updateModelRoute.useMutation({
    onSuccess: () => void utils.admin.modelRoutes.invalidate(),
  });
  const [drafts, setDrafts] = useState<Record<string, { model?: string; maxTokens?: string }>>({});

  return (
    <section style={box}>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: 16 }}>Model routes</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr>{['Stage', 'Primary model', 'Max tokens', 'Active', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(routes.data ?? []).map((r) => {
              const draft = drafts[r.id] ?? {};
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #262a33' }}>
                  <td style={td}>{r.stage}{r.workspaceId ? ` (ws ${r.workspaceId.slice(-6)})` : ''}</td>
                  <td style={td}>
                    <input
                      style={{ ...input, minWidth: 260 }}
                      value={draft.model ?? r.primaryModel}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], model: e.target.value } }))}
                    />
                  </td>
                  <td style={td}>
                    <input
                      style={{ ...input, width: 90 }}
                      value={draft.maxTokens ?? String(r.maxTokens)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], maxTokens: e.target.value } }))}
                    />
                  </td>
                  <td style={td}>
                    <button
                      style={r.active ? btn : ghost}
                      onClick={() => update.mutate({ routeId: r.id, active: !r.active })}
                    >
                      {r.active ? 'active' : 'inactive'}
                    </button>
                  </td>
                  <td style={td}>
                    <button
                      style={ghost}
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          routeId: r.id,
                          ...(draft.model ? { primaryModel: draft.model } : {}),
                          ...(draft.maxTokens ? { maxTokens: Number(draft.maxTokens) } : {}),
                        })
                      }
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {update.error && <p style={{ color: 'salmon', fontSize: 12 }}>{update.error.message}</p>}
    </section>
  );
}

function UsageSection() {
  const usage = trpc.admin.usage.useQuery(undefined, { refetchInterval: 15_000 });
  return (
    <section style={box}>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: 16 }}>Usage across workspaces</h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 0.4rem' }}>
        Counts and token totals only — content never leaves its workspace.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
          <thead>
            <tr>{['Workspace', 'Calls', 'Input', 'Cache read', 'Output', 'Est. cost', 'Pending', 'Failed'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(usage.data ?? []).map((u) => (
              <tr key={u.workspaceId} style={{ borderTop: '1px solid #262a33' }}>
                <td style={td}>{u.workspaceName} <code style={{ color: 'var(--muted)' }}>{u.workspaceId.slice(-6)}</code></td>
                <td style={td}>{u.calls}</td>
                <td style={td}>{u.inputTokens.toLocaleString('en-US')}</td>
                <td style={td}>{u.cacheReadTokens.toLocaleString('en-US')}</td>
                <td style={td}>{u.outputTokens.toLocaleString('en-US')}</td>
                <td style={td}>${u.costEstUsd.toFixed(2)}</td>
                <td style={td}>{u.jobsPending}</td>
                <td style={td}>{u.jobsFailed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SearchSection />
      <FlagsSection />
      <ModelRoutesSection />
      <UsageSection />
    </div>
  );
}
