'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

export function LicensingPanel() {
  const utils = trpc.useUtils();
  const overview = trpc.licensing.overview.useQuery(undefined, { refetchInterval: 8000 });
  const invalidate = () => void utils.licensing.overview.invalidate();
  const activate = trpc.licensing.activate.useMutation({ onSuccess: invalidate });
  const assign = trpc.licensing.assignSeat.useMutation({ onSuccess: invalidate });
  const unassign = trpc.licensing.unassignSeat.useMutation({ onSuccess: invalidate });
  const [key, setKey] = useState('');

  const data = overview.data;
  if (!data) return overview.isLoading ? null : <p className="muted">Unavailable.</p>;
  const isOwner = data.role === 'owner';

  return (
    <div className="stack">
      {data.access.mode !== 'full' && (
        <div className={data.access.mode === 'locked' ? 'alert alert-danger' : 'alert alert-warn'}>
          <strong>{data.access.mode === 'locked' ? 'No seat assigned' : 'Read-only workspace'}</strong>
          <p className="muted small" style={{ margin: '0.3rem 0 0' }}>{data.access.reason}</p>
        </div>
      )}

      {isOwner && (
        <section className="card row">
          <input
            className="input"
            style={{ minWidth: 320 }}
            placeholder="License key (lic_…)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={activate.isPending || key.trim().length < 8}
            onClick={() => activate.mutate({ key: key.trim() }, { onSuccess: () => setKey('') })}
          >
            Activate key
          </button>
          {activate.error && <span className="danger xsmall">{activate.error.message}</span>}
        </section>
      )}

      <section>
        <h2>Licenses</h2>
        {data.licenses.map((l) => (
          <div key={l.licenseId} className="card small" style={{ marginBottom: '0.5rem' }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <code>{l.keyMasked}</code>
              <span>{l.type === 'beta' ? 'Forge Vault beta' : 'standard'}</span>
              <span className={l.valid ? 'badge badge-ok' : 'badge badge-danger'}>{l.status}</span>
              <span className="muted">
                {l.assignments.length}/{l.seats} seats
                {l.expiresAt ? ` · expires ${new Date(l.expiresAt).toISOString().slice(0, 10)}` : ''}
              </span>
            </div>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
              {l.assignments.map((a) => (
                <li key={a.userId}>
                  {a.name ?? a.email}{' '}
                  {isOwner && (
                    <button
                      className="btn btn-sm"
                      onClick={() => unassign.mutate({ licenseId: l.licenseId, userId: a.userId })}
                    >
                      remove seat
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {data.licenses.length === 0 && (
          <p className="muted">
            No licenses yet — this workspace is in trial mode. Purchase seats to license it.
          </p>
        )}
      </section>

      <section>
        <h2>Members</h2>
        {data.members.map((m) => (
          <div key={m.userId} className="card row small" style={{ marginBottom: '0.4rem' }}>
            <span>{m.name ?? m.email}</span>
            <span className="muted">{m.role}</span>
            <span className={m.seated ? 'badge badge-ok' : 'badge badge-danger'}>{m.seated ? 'seated' : 'no seat'}</span>
            {isOwner &&
              !m.seated &&
              data.licenses
                .filter((l) => l.valid && l.assignments.length < l.seats)
                .slice(0, 1)
                .map((l) => (
                  <button
                    key={l.licenseId}
                    className="btn btn-primary btn-sm"
                    disabled={assign.isPending}
                    onClick={() => assign.mutate({ licenseId: l.licenseId, userId: m.userId })}
                  >
                    Assign seat ({l.keyMasked})
                  </button>
                ))}
          </div>
        ))}
        {assign.error && <p className="alert alert-danger">{assign.error.message}</p>}
      </section>
    </div>
  );
}
