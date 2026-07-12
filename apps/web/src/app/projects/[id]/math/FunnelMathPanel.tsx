'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';
import type { FunnelMathReport } from '@copyforge/core';

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
    <div className="stack-lg">
      <section className="no-print stack" style={{ maxWidth: 640 }}>
        <div className="row-lg">
          <label>
            Price $<br />
            <input value={price} onChange={(e) => setPrice(e.target.value)} className="input" style={{ width: 110 }} />
          </label>
          <label>
            Margin %<br />
            <input value={margin} onChange={(e) => setMargin(e.target.value)} className="input" style={{ width: 90 }} />
          </label>
          <label>
            Refund %<br />
            <input value={refund} onChange={(e) => setRefund(e.target.value)} className="input" style={{ width: 90 }} />
          </label>
        </div>

        <div className="stack-sm">
          <strong>Channels</strong>
          {channels.map((c, i) => (
            <div key={i} className="row">
              <input
                placeholder="channel (meta, youtube…)"
                value={c.name}
                onChange={(e) =>
                  setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                className="input"
                style={{ width: 200 }}
              />
              <input
                placeholder="CPC $"
                value={c.cpc}
                onChange={(e) =>
                  setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, cpc: e.target.value } : x)))
                }
                className="input"
                style={{ width: 100 }}
              />
              <input
                placeholder="CVR % (blank = benchmark)"
                value={c.cvr}
                onChange={(e) =>
                  setChannels((cs) => cs.map((x, j) => (j === i ? { ...x, cvr: e.target.value } : x)))
                }
                className="input"
                style={{ width: 200 }}
              />
              {channels.length > 1 && (
                <button
                  onClick={() => setChannels((cs) => cs.filter((_x, j) => j !== i))}
                  className="btn"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div>
            <button
              onClick={() => setChannels((cs) => [...cs, { name: '', cpc: '', cvr: '' }])}
              className="btn"
            >
              + channel
            </button>
          </div>
        </div>

        <div className="row">
          <button onClick={submit} disabled={run.isPending} className="btn btn-primary">
            {run.isPending ? 'Computing…' : 'Run Funnel Math (G1)'}
          </button>
          {report && (
            <button onClick={() => window.print()} className="btn">
              Print report
            </button>
          )}
        </div>
        {run.isError && <p className="alert alert-danger">{run.error.message}</p>}
      </section>

      {report && (
        <section className="print-report stack">
          <h2 style={{ margin: 0 }}>
            {report.pass ? (
              <span className="ok">● G1 PASS — economics viable</span>
            ) : (
              <span className="danger">■ G1 HARD STOP — funnel uneconomic</span>
            )}
          </h2>
          <table style={{ maxWidth: 560 }}>
            <tbody>
              {[
                ['Net revenue / sale', `$${report.netRevenuePerSale.toLocaleString()}`],
                ['Allowable CPA (breakeven)', `$${report.allowableCpa.toLocaleString()}`],
                ['Breakeven ROAS', `${report.breakevenRoas}×`],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">{k}</td>
                  <td>
                    <strong>{v}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table>
            <thead>
              <tr>
                {['Channel', 'CPC', 'CVR', 'Projected CPA', 'Required LTV', 'Breaks even?'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.channels.map((c) => (
                <tr key={c.name}>
                  <td>
                    {c.name}
                    {c.name === report.bestChannel ? ' ★' : ''}
                  </td>
                  <td>${c.cpc}</td>
                  <td>
                    {(c.cvr * 100).toFixed(2)}% <span className="muted">({c.cvrSource})</span>
                  </td>
                  <td>${c.projectedCpa.toLocaleString()}</td>
                  <td>${c.requiredLtv.toLocaleString()}</td>
                  <td className={c.breaksEven ? 'ok' : 'danger'}>
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
