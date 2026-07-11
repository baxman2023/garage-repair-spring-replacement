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
const th = { textAlign: 'left', padding: '0.3rem 0.6rem', color: 'var(--muted)', fontWeight: 400 } as const;
const td = { padding: '0.3rem 0.6rem' } as const;

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h2 style={{ margin: '0.25rem 0' }}>Funnel by market</h2>
          <button onClick={() => void downloadCsv()} style={btn}>Download CSV</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr>
                {['Market', 'Views', 'Quiz starts', 'Quiz completes', 'Optins', 'Calls', 'Qualified', 'Sales', 'Refunds', 'Retention 25/50/75/95'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(funnel.data?.markets ?? []).map((m) => (
                <tr key={m.marketId ?? 'none'} style={{ borderTop: '1px solid #262a33' }}>
                  <td style={td}>{m.label}</td>
                  <td style={td}>{m.pageViews}</td>
                  <td style={td}>{m.quizStarts}</td>
                  <td style={td}>{m.quizCompletes}</td>
                  <td style={td}>{m.optins}</td>
                  <td style={td}>{m.callsStarted}</td>
                  <td style={td}>{m.callsQualified}</td>
                  <td style={td}>{m.sales}</td>
                  <td style={td}>{m.refunds}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{retentionLabel(m.retention)}</td>
                </tr>
              ))}
              {funnel.data && (
                <tr style={{ borderTop: '1px solid #444', fontWeight: 600 }}>
                  <td style={td}>TOTAL</td>
                  <td style={td}>{funnel.data.total.pageViews}</td>
                  <td style={td}>{funnel.data.total.quizStarts}</td>
                  <td style={td}>{funnel.data.total.quizCompletes}</td>
                  <td style={td}>{funnel.data.total.optins}</td>
                  <td style={td}>{funnel.data.total.callsStarted}</td>
                  <td style={td}>{funnel.data.total.callsQualified}</td>
                  <td style={td}>{funnel.data.total.sales}</td>
                  <td style={td}>{funnel.data.total.refunds}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{retentionLabel(funnel.data.total.retention)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {funnel.data && funnel.data.markets.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>No events yet — wire ingest and the pixel first.</p>
          )}
        </div>
      </section>

      <section>
        <h2 style={{ margin: '0.25rem 0' }}>Controls & challenger queue</h2>
        {(controls.data ?? []).map((c) => (
          <div key={c.controlId} style={{ ...box, marginBottom: '0.6rem', fontSize: 13 }}>
            <strong>
              {c.assetType.replace(/_/g, ' ')} · {c.market ? `${c.market.rank}. ${c.market.label}` : 'unassigned'}
            </strong>{' '}
            <span style={{ color: 'var(--muted)' }}>
              control {c.assetId.slice(-8)} · {c.metrics.visitors} views · {c.metrics.conversions} sales
            </span>
            {c.challengers.length > 0 && (
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                {c.challengers.map((ch) => (
                  <li key={ch.id}>
                    challenger {ch.assetId.slice(-8)} — <em>{ch.status}</em>{' '}
                    <span style={{ color: 'var(--muted)' }}>
                      ({ch.metrics.visitors} views, {ch.metrics.conversions} sales)
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ color: 'var(--muted)', marginTop: '0.4rem' }}>
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
          <p style={{ color: 'var(--muted)' }}>No controls yet — the first approved asset per slot becomes one.</p>
        )}
      </section>

      <section>
        <h2 style={{ margin: '0.25rem 0' }}>Brier trend</h2>
        {(trend.data ?? []).length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr>{['Resolved', 'Metric', 'Brier', 'Running mean'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {trend.data!.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #262a33' }}>
                    <td style={td}>{new Date(t.at).toLocaleString()}</td>
                    <td style={td}>{t.metric}</td>
                    <td style={td}>{t.brier.toFixed(4)}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{t.runningMean.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)' }}>No resolved forecasts yet.</p>
        )}
      </section>
    </div>
  );
}
