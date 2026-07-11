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
  padding: '0.35rem 0.7rem',
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

export function LicensingPanel() {
  const utils = trpc.useUtils();
  const overview = trpc.licensing.overview.useQuery(undefined, { refetchInterval: 8000 });
  const invalidate = () => void utils.licensing.overview.invalidate();
  const activate = trpc.licensing.activate.useMutation({ onSuccess: invalidate });
  const assign = trpc.licensing.assignSeat.useMutation({ onSuccess: invalidate });
  const unassign = trpc.licensing.unassignSeat.useMutation({ onSuccess: invalidate });
  const [key, setKey] = useState('');

  const data = overview.data;
  if (!data) return overview.isLoading ? null : <p style={{ color: 'var(--muted)' }}>Unavailable.</p>;
  const isOwner = data.role === 'owner';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {data.access.mode !== 'full' && (
        <div style={{ ...box, borderColor: data.access.mode === 'locked' ? 'salmon' : 'orange' }}>
          <strong>{data.access.mode === 'locked' ? 'No seat assigned' : 'Read-only workspace'}</strong>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--muted)', fontSize: 13 }}>{data.access.reason}</p>
        </div>
      )}

      {isOwner && (
        <section style={{ ...box, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ ...input, minWidth: 320 }}
            placeholder="License key (lic_…)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            style={btn}
            disabled={activate.isPending || key.trim().length < 8}
            onClick={() => activate.mutate({ key: key.trim() }, { onSuccess: () => setKey('') })}
          >
            Activate key
          </button>
          {activate.error && <span style={{ color: 'salmon', fontSize: 12 }}>{activate.error.message}</span>}
        </section>
      )}

      <section>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: 16 }}>Licenses</h2>
        {data.licenses.map((l) => (
          <div key={l.licenseId} style={{ ...box, marginBottom: '0.5rem', fontSize: 13 }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <code>{l.keyMasked}</code>
              <span>{l.type === 'beta' ? 'Forge Vault beta' : 'standard'}</span>
              <span style={{ color: l.valid ? 'var(--ok)' : 'salmon' }}>{l.status}</span>
              <span style={{ color: 'var(--muted)' }}>
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
                      style={{ ...ghost, padding: '0.1rem 0.4rem' }}
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
          <p style={{ color: 'var(--muted)' }}>
            No licenses yet — this workspace is in trial mode. Purchase seats to license it.
          </p>
        )}
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: 16 }}>Members</h2>
        {data.members.map((m) => (
          <div key={m.userId} style={{ ...box, marginBottom: '0.4rem', fontSize: 13, display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{m.name ?? m.email}</span>
            <span style={{ color: 'var(--muted)' }}>{m.role}</span>
            <span style={{ color: m.seated ? 'var(--ok)' : 'salmon' }}>{m.seated ? 'seated' : 'no seat'}</span>
            {isOwner &&
              !m.seated &&
              data.licenses
                .filter((l) => l.valid && l.assignments.length < l.seats)
                .slice(0, 1)
                .map((l) => (
                  <button
                    key={l.licenseId}
                    style={btn}
                    disabled={assign.isPending}
                    onClick={() => assign.mutate({ licenseId: l.licenseId, userId: m.userId })}
                  >
                    Assign seat ({l.keyMasked})
                  </button>
                ))}
          </div>
        ))}
        {assign.error && <p style={{ color: 'salmon', fontSize: 12 }}>{assign.error.message}</p>}
      </section>
    </div>
  );
}
