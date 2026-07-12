'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

function SearchSection() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const search = trpc.admin.search.useQuery({ query: submitted }, { enabled: submitted.length > 0 });

  return (
    <section className="card">
      <h2>Search users · workspaces · licenses</h2>
      <div className="row">
        <input
          className="input"
          style={{ minWidth: 280 }}
          placeholder="email, name, workspace, license key…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSubmitted(query.trim())}
        />
        <button className="btn btn-primary" onClick={() => setSubmitted(query.trim())}>Search</button>
      </div>
      {search.data && (
        <div className="stack-sm small" style={{ marginTop: '0.6rem' }}>
          {search.data.users.map((u) => (
            <div key={u.id}>
              user · {u.email} {u.name ? `(${u.name})` : ''} {u.isPlatformAdmin ? '· platform admin' : ''}
            </div>
          ))}
          {search.data.workspaces.map((w) => (
            <div key={w.id}>workspace · {w.name} <code className="muted">{w.id}</code></div>
          ))}
          {search.data.licenses.map((l) => (
            <div key={l.id}>
              license · <code>{l.keyMasked}</code> · {l.type} · {l.status} · {l.seats} seats
              {l.workspaceId ? '' : ' · unactivated'}
            </div>
          ))}
          {search.data.users.length + search.data.workspaces.length + search.data.licenses.length === 0 && (
            <span className="muted">No matches.</span>
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
    <section className="card">
      <h2>Feature flags & kill switches</h2>
      {data.flags
        .filter((f) => f.key !== 'paused_job_types')
        .map((f) => (
          <div key={f.key} className="row small" style={{ marginBottom: '0.3rem' }}>
            <button
              className={f.enabled ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
              disabled={setFlag.isPending}
              onClick={() => setFlag.mutate({ key: f.key, enabled: !f.enabled })}
            >
              {f.enabled ? 'ON' : 'OFF'}
            </button>
            <code>{f.key}</code>
            <span className="muted">{f.description}</span>
          </div>
        ))}

      <h3>Paused job types</h3>
      <p className="muted xsmall">
        Effective pause set (incl. the generation master switch):{' '}
        {data.pausedJobTypes.length ? data.pausedJobTypes.join(', ') : 'none'}
      </p>
      <div className="row">
        {data.knownJobTypes.map((t) => {
          const paused = surgicalTypes.includes(t);
          return (
            <button
              key={t}
              className={paused ? 'btn btn-sm btn-danger' : 'btn btn-sm'}
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
    <section className="card">
      <h2>Model routes</h2>
      <div className="table-wrap">
        <table style={{ minWidth: 720 }}>
          <thead>
            <tr>{['Stage', 'Primary model', 'Max tokens', 'Active', ''].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(routes.data ?? []).map((r) => {
              const draft = drafts[r.id] ?? {};
              return (
                <tr key={r.id}>
                  <td>{r.stage}{r.workspaceId ? ` (ws ${r.workspaceId.slice(-6)})` : ''}</td>
                  <td>
                    <input
                      className="input"
                      style={{ minWidth: 260 }}
                      value={draft.model ?? r.primaryModel}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], model: e.target.value } }))}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ width: 90 }}
                      value={draft.maxTokens ?? String(r.maxTokens)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], maxTokens: e.target.value } }))}
                    />
                  </td>
                  <td>
                    <button
                      className={r.active ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                      onClick={() => update.mutate({ routeId: r.id, active: !r.active })}
                    >
                      {r.active ? 'active' : 'inactive'}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn btn-sm"
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
      {update.error && <p className="alert alert-danger">{update.error.message}</p>}
    </section>
  );
}

function UsageSection() {
  const usage = trpc.admin.usage.useQuery(undefined, { refetchInterval: 15_000 });
  return (
    <section className="card">
      <h2>Usage across workspaces</h2>
      <p className="muted xsmall">
        Counts and token totals only — content never leaves its workspace.
      </p>
      <div className="table-wrap">
        <table style={{ minWidth: 760 }}>
          <thead>
            <tr>{['Workspace', 'Calls', 'Input', 'Cache read', 'Output', 'Est. cost', 'Pending', 'Failed'].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(usage.data ?? []).map((u) => (
              <tr key={u.workspaceId}>
                <td>{u.workspaceName} <code className="muted">{u.workspaceId.slice(-6)}</code></td>
                <td>{u.calls}</td>
                <td>{u.inputTokens.toLocaleString('en-US')}</td>
                <td>{u.cacheReadTokens.toLocaleString('en-US')}</td>
                <td>{u.outputTokens.toLocaleString('en-US')}</td>
                <td>${u.costEstUsd.toFixed(2)}</td>
                <td>{u.jobsPending}</td>
                <td>{u.jobsFailed}</td>
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
    <div className="stack">
      <SearchSection />
      <FlagsSection />
      <ModelRoutesSection />
      <UsageSection />
    </div>
  );
}
