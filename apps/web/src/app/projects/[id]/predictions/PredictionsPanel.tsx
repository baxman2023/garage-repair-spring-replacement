'use client';

import { trpc } from '@/trpc/react';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function PredictionsPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.predictions.list.useQuery({ projectId }, { refetchInterval: 6000 });
  const invalidate = () => void utils.predictions.list.invalidate({ projectId });
  const resolve = trpc.predictions.resolveNow.useMutation({ onSuccess: invalidate });
  const calibrate = trpc.predictions.calibrateNow.useMutation({ onSuccess: invalidate });

  const data = list.data;
  if (!data) return list.isLoading ? null : <p className="muted">No data.</p>;

  return (
    <div className="stack">
      <section className="row">
        <button
          onClick={() => resolve.mutate({ projectId })}
          disabled={resolve.isPending}
          className="btn btn-primary btn-sm"
        >
          Resolve now
        </button>
        <button
          onClick={() => calibrate.mutate({ projectId })}
          disabled={calibrate.isPending}
          className="btn btn-primary btn-sm"
        >
          Run calibration
        </button>
        {resolve.data && (
          <span className="muted xsmall">
            resolved {resolve.data.resolved}, pending {resolve.data.pending}
          </span>
        )}
      </section>

      <section>
        <div className="table-wrap">
          <table style={{ minWidth: 720 }}>
            <thead>
              <tr>
                {['Subject', 'Metric', 'Predicted', 'Band', 'Actual', 'Brier', 'Status'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.predictions.map((p) => {
                const inBand =
                  p.actual !== null && p.band ? p.actual >= p.band.low && p.actual <= p.band.high : null;
                return (
                  <tr key={p.id}>
                    <td>
                      {p.assetType.replace(/_/g, ' ')} {p.subjectId.slice(-8)}
                    </td>
                    <td>{p.metric}</td>
                    <td>{pct(p.predicted)}</td>
                    <td className="muted">
                      {p.band ? `${pct(p.band.low)}–${pct(p.band.high)}` : '—'}
                    </td>
                    <td className={inBand === null ? 'muted' : inBand ? 'ok' : 'danger'}>
                      {p.actual !== null ? pct(p.actual) : 'awaiting volume'}
                    </td>
                    <td>{p.brier !== null ? p.brier.toFixed(4) : '—'}</td>
                    <td>
                      {p.resolvedAt ? (
                        <span className="badge badge-ok">resolved</span>
                      ) : (
                        <span className="badge">open</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.predictions.length === 0 && (
          <p className="muted">No forecasts yet — they record at approval.</p>
        )}
      </section>

      {calibrate.data && (
        <section className="card small">
          <strong>Calibration report</strong>
          <div className="muted" style={{ margin: '4px 0' }}>{calibrate.data.bounds}</div>
          {calibrate.data.perMetric.map((m) => (
            <div key={m.metric}>
              {m.metric}: {m.samples} samples · mean actual {pct(m.meanActual)} · mean Brier{' '}
              {m.meanBrier.toFixed(4)} · prior factor {m.priorFactor}
            </div>
          ))}
          {calibrate.data.lensNotes.map((n, i) => (
            <div key={i} className="muted">{n}</div>
          ))}
        </section>
      )}
    </div>
  );
}
