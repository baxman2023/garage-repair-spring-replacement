'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.6rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;
const btn = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333', padding: '0.3rem 0.6rem' } as const;

export function MarketsPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const markets = trpc.markets.list.useQuery({ projectId }, { refetchInterval: 4000 });
  const invalidate = () => void utils.markets.list.invalidate({ projectId });

  const run = trpc.markets.run.useMutation();
  const swap = trpc.markets.swap.useMutation({ onSuccess: invalidate });
  const update = trpc.markets.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });
  const addManual = trpc.markets.addManual.useMutation({
    onSuccess: () => {
      setManualLabel('');
      setManualRationale('');
      invalidate();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRationale, setEditRationale] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [manualRationale, setManualRationale] = useState('');

  const rows = markets.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => run.mutate({ projectId })} disabled={run.isPending} style={btn}>
          {run.isPending ? 'Queued…' : rows.length ? 'Re-run selection' : 'Run Market Selection'}
        </button>
        {run.isSuccess && <span style={{ color: 'var(--muted)' }}>Selecting — the list refreshes automatically.</span>}
        {run.isError && <span style={{ color: 'salmon' }}>{run.error.message}</span>}
        {rows.some((r) => r.origin === 'user') && (
          <span style={{ color: 'var(--muted)' }}>Your edited markets survive re-runs.</span>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {rows.map((m, idx) => (
          <div key={m.id} style={{ ...box, display: 'flex', gap: '0.75rem' }}>
            <div style={{ fontSize: 22, fontWeight: 700, minWidth: 34, color: 'var(--accent)' }}>
              #{m.rank}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {editingId === m.id ? (
                <>
                  <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={box} />
                  <textarea
                    rows={3}
                    value={editRationale}
                    onChange={(e) => setEditRationale(e.target.value)}
                    style={{ ...box, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() =>
                        update.mutate({ projectId, marketId: m.id, label: editLabel, rationale: editRationale })
                      }
                      disabled={update.isPending}
                      style={btn}
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} style={subtle}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <strong>
                      {m.label}{' '}
                      {m.origin === 'user' && (
                        <span style={{ color: 'var(--ok)', fontWeight: 400 }}>(yours)</span>
                      )}
                    </strong>
                    <span style={{ color: 'var(--muted)' }}>
                      {m.scoreTotal !== null ? `${m.scoreTotal}/100` : 'unscored'}
                    </span>
                  </div>
                  {m.avatarHint && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{m.avatarHint}</div>}
                  <div style={{ fontSize: 13 }}>{m.rationale}</div>
                  {m.scores && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {Object.entries(m.scores)
                        .map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`)
                        .join(' · ')}
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <button
                onClick={() => idx > 0 && swap.mutate({ projectId, marketIdA: m.id, marketIdB: rows[idx - 1]!.id })}
                disabled={idx === 0 || swap.isPending}
                style={{ ...subtle, opacity: idx === 0 ? 0.4 : 1 }}
              >
                ↑
              </button>
              <button
                onClick={() =>
                  idx < rows.length - 1 && swap.mutate({ projectId, marketIdA: m.id, marketIdB: rows[idx + 1]!.id })
                }
                disabled={idx === rows.length - 1 || swap.isPending}
                style={{ ...subtle, opacity: idx === rows.length - 1 ? 0.4 : 1 }}
              >
                ↓
              </button>
              <button
                onClick={() => {
                  setEditingId(m.id);
                  setEditLabel(m.label);
                  setEditRationale(m.rationale ?? '');
                }}
                style={subtle}
              >
                Edit
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>No markets yet — run the selection engine.</p>}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 640 }}>
        <h3 style={{ margin: 0 }}>Add a market manually</h3>
        <input
          placeholder="Segment label…"
          value={manualLabel}
          onChange={(e) => setManualLabel(e.target.value)}
          style={box}
        />
        <textarea
          rows={2}
          placeholder="Why this crowd…"
          value={manualRationale}
          onChange={(e) => setManualRationale(e.target.value)}
          style={{ ...box, fontFamily: 'inherit' }}
        />
        <div>
          <button
            onClick={() => addManual.mutate({ projectId, label: manualLabel, rationale: manualRationale })}
            disabled={addManual.isPending || !manualLabel.trim() || !manualRationale.trim()}
            style={btn}
          >
            Add market
          </button>
        </div>
        {addManual.isError && <p style={{ color: 'salmon' }}>{addManual.error.message}</p>}
      </section>
    </div>
  );
}
