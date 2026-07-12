'use client';

import { trpc } from '@/trpc/react';

const STATUS_BADGE: Record<string, string> = {
  queued: 'badge',
  live: 'badge badge-warn',
  won: 'badge badge-ok',
  lost: 'badge badge-danger',
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
  if (!data) return list.isLoading ? null : <p className="muted">No data.</p>;
  if (data.length === 0)
    return <p className="muted">No controls yet — the first APPROVED asset per market × type takes the slot automatically.</p>;

  return (
    <div className="stack">
      {(promote.isError || setLive.isError || markLost.isError) && (
        <p className="alert alert-danger">
          {promote.error?.message ?? setLive.error?.message ?? markLost.error?.message}
        </p>
      )}
      {data.map((c) => (
        <section key={c.controlId} className="card stack-sm">
          <div className="row">
            <strong>
              👑 {c.assetType.replace(/_/g, ' ')} @ #{c.market?.rank} {c.market?.label}
            </strong>
            <span className="muted xsmall">
              control asset {c.assetId.slice(-8)} · since {new Date(c.since).toLocaleDateString()} ·{' '}
              {c.metrics.visitors} visitors / {c.metrics.conversions} sales
            </span>
            <button onClick={() => create.mutate({ controlId: c.controlId })} disabled={create.isPending} className="btn btn-primary btn-sm">
              Generate challenger
            </button>
          </div>

          {c.challengers.length > 0 && (
            <div className="small stack-sm">
              {c.challengers.map((ch) => (
                <div key={ch.id} className="row">
                  <span className={STATUS_BADGE[ch.status]}>{ch.status}</span>
                  <span>asset {ch.assetId.slice(-8)}</span>
                  <span className="muted">
                    {ch.metrics.visitors} visitors / {ch.metrics.conversions} sales
                  </span>
                  {ch.status === 'queued' && (
                    <button onClick={() => setLive.mutate({ challengerId: ch.id })} className="btn btn-sm">
                      Go live
                    </button>
                  )}
                  {ch.status === 'live' && (
                    <>
                      <button onClick={() => promote.mutate({ challengerId: ch.id })} className="btn btn-primary btn-sm">
                        Promote (owner)
                      </button>
                      <button
                        onClick={() => markLost.mutate({ challengerId: ch.id, reason: 'control held' })}
                        className="btn btn-sm"
                      >
                        Mark lost
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <details className="muted xsmall">
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
