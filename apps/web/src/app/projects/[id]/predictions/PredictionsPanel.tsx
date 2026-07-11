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

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function PredictionsPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.predictions.list.useQuery({ projectId }, { refetchInterval: 6000 });
  const invalidate = () => void utils.predictions.list.invalidate({ projectId });
  const resolve = trpc.predictions.resolveNow.useMutation({ onSuccess: invalidate });
  const calibrate = trpc.predictions.calibrateNow.useMutation({ onSuccess: invalidate });

  const data = list.data;
  if (!data) return list.isLoading ? null : <p style={{ color: 'var(--muted)' }}>No data.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => resolve.mutate({ projectId })} disabled={resolve.isPending} style={btn}>
          Resolve now
        </button>
        <button onClick={() => calibrate.mutate({ projectId })} disabled={calibrate.isPending} style={btn}>
          Run calibration
        </button>
        {resolve.data && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            resolved {resolve.data.resolved}, pending {resolve.data.pending}
          </span>
        )}
      </section>

      <section style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr>
              {['Subject', 'Metric', 'Predicted', 'Band', 'Actual', 'Brier', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '0.3rem 0.6rem', color: 'var(--muted)', fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.predictions.map((p) => {
              const inBand =
                p.actual !== null && p.band ? p.actual >= p.band.low && p.actual <= p.band.high : null;
              return (
                <tr key={p.id} style={{ borderTop: '1px solid #262a33' }}>
                  <td style={{ padding: '0.3rem 0.6rem' }}>
                    {p.assetType.replace(/_/g, ' ')} {p.subjectId.slice(-8)}
                  </td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>{p.metric}</td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>{pct(p.predicted)}</td>
                  <td style={{ padding: '0.3rem 0.6rem', color: 'var(--muted)' }}>
                    {p.band ? `${pct(p.band.low)}–${pct(p.band.high)}` : '—'}
                  </td>
                  <td style={{ padding: '0.3rem 0.6rem', color: inBand === null ? 'var(--muted)' : inBand ? 'var(--ok)' : 'salmon' }}>
                    {p.actual !== null ? pct(p.actual) : 'awaiting volume'}
                  </td>
                  <td style={{ padding: '0.3rem 0.6rem' }}>{p.brier !== null ? p.brier.toFixed(4) : '—'}</td>
                  <td style={{ padding: '0.3rem 0.6rem', color: p.resolvedAt ? 'var(--ok)' : 'var(--muted)' }}>
                    {p.resolvedAt ? 'resolved' : 'open'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.predictions.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No forecasts yet — they record at approval.</p>
        )}
      </section>

      {calibrate.data && (
        <section style={{ ...box, fontSize: 13 }}>
          <strong>Calibration report</strong>
          <div style={{ color: 'var(--muted)', margin: '4px 0' }}>{calibrate.data.bounds}</div>
          {calibrate.data.perMetric.map((m) => (
            <div key={m.metric}>
              {m.metric}: {m.samples} samples · mean actual {pct(m.meanActual)} · mean Brier{' '}
              {m.meanBrier.toFixed(4)} · prior factor {m.priorFactor}
            </div>
          ))}
          {calibrate.data.lensNotes.map((n, i) => (
            <div key={i} style={{ color: 'var(--muted)' }}>{n}</div>
          ))}
        </section>
      )}
    </div>
  );
}
