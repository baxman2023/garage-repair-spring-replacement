'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';
import type { FunnelMathReport } from '@copyforge/core';

const box = {
  padding: '0.5rem',
  borderRadius: 6,
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

interface ChannelDraft {
  name: string;
  cpc: string;
  cvr: string;
}

export function FunnelMathPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const latest = trpc.funnelMath.latest.useQuery({ projectId });
  const run = trpc.funnelMath.run.useMutation({
    onSuccess: () => void utils.funnelMath.latest.invalidate({ projectId }),
  });

  const [price, setPrice] = useState('1000');
  const [margin, setMargin] = useState('80');
  const [refund, setRefund] = useState('5');
  const [channels, setChannels] = useState<ChannelDraft[]>([
    { name: 'meta', cpc: '2.00', cvr: '' },
  ]);

  const report: FunnelMathReport | null = run.data ?? latest.data?.report ?? null;

  function submit() {
    run.mutate({
      projectId,
      inputs: {
        price: Number(price),
        margin: Number(margin) / 100,
        refundRate: Number(refund) / 100,
        channels: channels
          .filter((c) => c.name.trim() && Number(c.cpc) > 0)
          .map((c) => ({
            name: c.name.trim(),
            cpc: Number(c.cpc),
            ...(c.cvr.trim() ? { cvr: Number(c.cvr) / 100 } : {}),
          })),
      },
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label>
            Price $<br />
            <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...box, width: 110 }} />
          </label>
          <label>
            Margin %<br />
            <input value={margin} onChange={(e) => setMargin(e.target.value)} style={{ ...box, width: 90 }} />
          </label>
          <label>
            Refund %<br />
            <input value={refund} onChange={(e) => setRefund(e.target.value)} style={{ ...box, width: 90 }} />
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <strong>Channels</strong>
          {channels.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                placeholder="channel (meta, youtube…)"
                value={c.name}
                onChange={(e) =>
                  setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                style={{ ...box, width: 200 }}
              />
              <input
                placeholder="CPC $"
                value={c.cpc}
                onChange={(e) =>
                  setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, cpc: e.target.value } : x)))
                }
                style={{ ...box, width: 100 }}
              />
              <input
                placeholder="CVR % (blank = benchmark)"
                value={c.cvr}
                onChange={(e) =>
                  setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, cvr: e.target.value } : x)))
                }
                style={{ ...box, width: 200 }}
              />
              {channels.length > 1 && (
                <button
                  onClick={() => setChannels((cs) => cs.filter((_x, j) => j !== i))}
                  style={{ ...box, cursor: 'pointer' }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div>
            <button
              onClick={() => setChannels((cs) => [...cs, { name: '', cpc: '', cvr: '' }])}
              style={{ ...box, cursor: 'pointer' }}
            >
              + channel
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={submit} disabled={run.isPending} style={btn}>
            {run.isPending ? 'Computing…' : 'Run Funnel Math (G1)'}
          </button>
          {report && (
            <button onClick={() => window.print()} style={{ ...box, cursor: 'pointer' }}>
              Print report
            </button>
          )}
        </div>
        {run.isError && <p style={{ color: 'salmon' }}>{run.error.message}</p>}
      </section>

      {report && (
        <section className="print-report" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>
            {report.pass ? (
              <span style={{ color: 'var(--ok)' }}>● G1 PASS — economics viable</span>
            ) : (
              <span style={{ color: 'salmon' }}>■ G1 HARD STOP — funnel uneconomic</span>
            )}
          </h2>
          <table style={{ borderCollapse: 'collapse', maxWidth: 560 }}>
            <tbody>
              {[
                ['Net revenue / sale', `$${report.netRevenuePerSale.toLocaleString()}`],
                ['Allowable CPA (breakeven)', `$${report.allowableCpa.toLocaleString()}`],
                ['Breakeven ROAS', `${report.breakevenRoas}×`],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '0.3rem 0.75rem 0.3rem 0', color: 'var(--muted)' }}>{k}</td>
                  <td style={{ padding: '0.3rem 0' }}>
                    <strong>{v}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Channel', 'CPC', 'CVR', 'Projected CPA', 'Required LTV', 'Breaks even?'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.3rem 0.9rem 0.3rem 0', borderBottom: '1px solid #333' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.channels.map((c) => (
                <tr key={c.name}>
                  <td style={{ padding: '0.3rem 0.9rem 0.3rem 0' }}>
                    {c.name}
                    {c.name === report.bestChannel ? ' ★' : ''}
                  </td>
                  <td style={{ padding: '0.3rem 0.9rem 0.3rem 0' }}>${c.cpc}</td>
                  <td style={{ padding: '0.3rem 0.9rem 0.3rem 0' }}>
                    {(c.cvr * 100).toFixed(2)}% <span style={{ color: 'var(--muted)' }}>({c.cvrSource})</span>
                  </td>
                  <td style={{ padding: '0.3rem 0.9rem 0.3rem 0' }}>${c.projectedCpa.toLocaleString()}</td>
                  <td style={{ padding: '0.3rem 0.9rem 0.3rem 0' }}>${c.requiredLtv.toLocaleString()}</td>
                  <td style={{ padding: '0.3rem 0', color: c.breaksEven ? 'var(--ok)' : 'salmon' }}>
                    {c.breaksEven ? 'yes' : 'no'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!report.pass && (
            <div>
              <h3>Fix list (easiest first) — route back to the Offer Forge (G0)</h3>
              <ol>
                {report.fixes.map((f, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{f.lever}</strong>: {f.detail}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      <style>{`@media print {
        .no-print { display: none !important; }
        body { background: #fff !important; color: #000 !important; }
        .print-report * { color: #000 !important; }
      }`}</style>
    </div>
  );
}
