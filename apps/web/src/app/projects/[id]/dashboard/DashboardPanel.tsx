'use client';

import { trpc } from '@/trpc/react';

function retentionLabel(r: { starts: number; q25: number; q50: number; q75: number; q95: number }) {
  if (r.starts === 0) return '—';
  const pct = (n: number) => `${Math.round((n / r.starts) * 100)}%`;
  return `${pct(r.q25)} / ${pct(r.q50)} / ${pct(r.q75)} / ${pct(r.q95)}`;
}

export function DashboardPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const funnel = trpc.dashboards.funnel.useQuery({ projectId }, { refetchInterval: 8000 });
  const trend = trpc.dashboards.brierTrend.useQuery({ projectId }, { refetchInterval: 15000 });
  const controls = trpc.controls.list.useQuery({ projectId }, { refetchInterval: 8000 });

  const downloadCsv = async () => {
    const { csv, filename } = await utils.dashboards.exportCsv.fetch({ projectId });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack">
      <section>
        <div className="row-lg">
          <h2 style={{ margin: '0.25rem 0' }}>Funnel by market</h2>
          <button onClick={() => void downloadCsv()} className="btn btn-primary btn-sm">Download CSV</button>
        </div>
        <div className="table-wrap">
          <table style={{ minWidth: 900 }}>
            <thead>
              <tr>
                {['Market', 'Views', 'Quiz starts', 'Quiz completes', 'Optins', 'Calls', 'Qualified', 'Sales', 'Refunds', 'Retention 25/50/75/95'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(funnel.data?.markets ?? []).map((m) => (
                <tr key={m.marketId ?? 'none'}>
                  <td>{m.label}</td>
                  <td>{m.pageViews}</td>
                  <td>{m.quizStarts}</td>
                  <td>{m.quizCompletes}</td>
                  <td>{m.optins}</td>
                  <td>{m.callsStarted}</td>
                  <td>{m.callsQualified}</td>
                  <td>{m.sales}</td>
                  <td>{m.refunds}</td>
                  <td className="muted">{retentionLabel(m.retention)}</td>
                </tr>
              ))}
              {funnel.data && (
                <tr style={{ fontWeight: 600 }}>
                  <td>TOTAL</td>
                  <td>{funnel.data.total.pageViews}</td>
                  <td>{funnel.data.total.quizStarts}</td>
                  <td>{funnel.data.total.quizCompletes}</td>
                  <td>{funnel.data.total.optins}</td>
                  <td>{funnel.data.total.callsStarted}</td>
                  <td>{funnel.data.total.callsQualified}</td>
                  <td>{funnel.data.total.sales}</td>
                  <td>{funnel.data.total.refunds}</td>
                  <td className="muted">{retentionLabel(funnel.data.total.retention)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {funnel.data && funnel.data.markets.length === 0 && (
          <p className="muted">No events yet — wire ingest and the pixel first.</p>
        )}
      </section>

      <section>
        <h2 style={{ margin: '0.25rem 0' }}>Controls & challenger queue</h2>
        {(controls.data ?? []).map((c) => (
          <div key={c.controlId} className="card small" style={{ marginBottom: '0.6rem' }}>
            <strong>
              {c.assetType.replace(/_/g, ' ')} · {c.market ? `${c.market.rank}. ${c.market.label}` : 'unassigned'}
            </strong>{' '}
            <span className="muted">
              control {c.assetId.slice(-8)} · {c.metrics.visitors} views · {c.metrics.conversions} sales
            </span>
            {c.challengers.length > 0 && (
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                {c.challengers.map((ch) => (
                  <li key={ch.id}>
                    challenger {ch.assetId.slice(-8)} — <em>{ch.status}</em>{' '}
                    <span className="muted">
                      ({ch.metrics.visitors} views, {ch.metrics.conversions} sales)
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="muted" style={{ marginTop: '0.4rem' }}>
              {c.lineage.map((l, i) => {
                const note = typeof l.meta.reason === 'string' && l.meta.reason ? ` (${l.meta.reason})` : '';
                return (
                  <div key={i}>
                    {new Date(l.at).toLocaleString()} — {l.action}
                    {note}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {controls.data && controls.data.length === 0 && (
          <p className="muted">No controls yet — the first approved asset per slot becomes one.</p>
        )}
      </section>

      <section>
        <h2 style={{ margin: '0.25rem 0' }}>Brier trend</h2>
        {(trend.data ?? []).length > 0 ? (
          <div className="table-wrap">
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>{['Resolved', 'Metric', 'Brier', 'Running mean'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {trend.data!.map((t, i) => (
                  <tr key={i}>
                    <td>{new Date(t.at).toLocaleString()}</td>
                    <td>{t.metric}</td>
                    <td>{t.brier.toFixed(4)}</td>
                    <td className="muted">{t.runningMean.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No resolved forecasts yet.</p>
        )}
      </section>
    </div>
  );
}
