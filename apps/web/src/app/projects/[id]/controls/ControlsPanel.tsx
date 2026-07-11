'use client';

import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;
const btn = {
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

const STATUS_COLOR: Record<string, string> = {
  queued: 'var(--muted)',
  live: '#f0c674',
  won: 'var(--ok)',
  lost: 'salmon',
};

export function ControlsPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.controls.list.useQuery({ projectId }, { refetchInterval: 5000 });
  const invalidate = () => void utils.controls.list.invalidate({ projectId });
  const create = trpc.controls.createChallenger.useMutation({ onSuccess: invalidate });
  const setLive = trpc.controls.setLive.useMutation({ onSuccess: invalidate });
  const promote = trpc.controls.promote.useMutation({ onSuccess: invalidate });
  const markLost = trpc.controls.markLost.useMutation({ onSuccess: invalidate });

  const data = list.data;
  if (!data) return list.isLoading ? null : <p style={{ color: 'var(--muted)' }}>No data.</p>;
  if (data.length === 0)
    return <p style={{ color: 'var(--muted)' }}>No controls yet — the first APPROVED asset per market × type takes the slot automatically.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {(promote.isError || setLive.isError || markLost.isError) && (
        <p style={{ color: 'salmon' }}>
          {promote.error?.message ?? setLive.error?.message ?? markLost.error?.message}
        </p>
      )}
      {data.map((c) => (
        <section key={c.controlId} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>
              👑 {c.assetType.replace(/_/g, ' ')} @ #{c.market?.rank} {c.market?.label}
            </strong>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              control asset {c.assetId.slice(-8)} · since {new Date(c.since).toLocaleDateString()} ·{' '}
              {c.metrics.visitors} visitors / {c.metrics.conversions} sales
            </span>
            <button onClick={() => create.mutate({ controlId: c.controlId })} disabled={create.isPending} style={btn}>
              Generate challenger
            </button>
          </div>

          {c.challengers.length > 0 && (
            <div style={{ fontSize: 13 }}>
              {c.challengers.map((ch) => (
                <div key={ch.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: STATUS_COLOR[ch.status] }}>[{ch.status}]</span>
                  <span>asset {ch.assetId.slice(-8)}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {ch.metrics.visitors} visitors / {ch.metrics.conversions} sales
                  </span>
                  {ch.status === 'queued' && (
                    <button onClick={() => setLive.mutate({ challengerId: ch.id })} style={subtle}>
                      Go live
                    </button>
                  )}
                  {ch.status === 'live' && (
                    <>
                      <button onClick={() => promote.mutate({ challengerId: ch.id })} style={btn}>
                        Promote (owner)
                      </button>
                      <button
                        onClick={() => markLost.mutate({ challengerId: ch.id, reason: 'control held' })}
                        style={subtle}
                      >
                        Mark lost
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <details style={{ fontSize: 12, color: 'var(--muted)' }}>
            <summary>Control lineage ({c.lineage.length} events)</summary>
            {c.lineage.map((l, i) => (
              <div key={i} style={{ marginTop: 4 }}>
                {new Date(l.at).toLocaleString()} — <strong>{l.action}</strong>{' '}
                {l.action === 'control.promoted' &&
                  `(${String((l.meta as { fromAssetId?: string }).fromAssetId ?? '').slice(-8)} → ${String((l.meta as { toAssetId?: string }).toAssetId ?? '').slice(-8)})`}
              </div>
            ))}
          </details>
        </section>
      ))}
    </div>
  );
}
