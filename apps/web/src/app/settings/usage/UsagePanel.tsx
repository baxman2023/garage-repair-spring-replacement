'use client';

import { trpc } from '@/trpc/react';

const n = (x: number) => x.toLocaleString('en-US');
const usd = (x: number) => `$${x.toFixed(4)}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function TotalsRow({ label, u }: { label: string; u: { calls: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; costEstUsd: number; cacheHitRate: number } }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{n(u.calls)}</td>
      <td>{n(u.inputTokens)}</td>
      <td>{n(u.cacheReadTokens)}</td>
      <td>{n(u.outputTokens)}</td>
      <td className={u.cacheHitRate > 0.5 ? 'ok' : undefined}>{pct(u.cacheHitRate)}</td>
      <td>{usd(u.costEstUsd)}</td>
    </tr>
  );
}

const HEADERS = ['', 'Calls', 'Input', 'Cache read', 'Output', 'Cache hit', 'Est. cost'];

export function UsagePanel() {
  const ws = trpc.usage.workspace.useQuery(undefined, { refetchInterval: 15_000 });
  const monthly = trpc.usage.monthly.useQuery(undefined, { refetchInterval: 60_000 });

  return (
    <div className="stack">
      <section className="card">
        <h2>This workspace</h2>
        <div className="table-wrap">
          <table style={{ minWidth: 720 }}>
            <thead><tr>{HEADERS.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {ws.data && <TotalsRow label="Total" u={ws.data.total} />}
              {(ws.data?.perProject ?? []).map((p) => (
                <TotalsRow key={p.projectId ?? 'none'} label={p.projectName} u={p.usage} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Monthly summary</h2>
        <div className="table-wrap">
          <table style={{ minWidth: 720 }}>
            <thead><tr>{HEADERS.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {(monthly.data ?? []).map((m) => (
                <TotalsRow key={m.month} label={m.month} u={m.usage} />
              ))}
            </tbody>
          </table>
        </div>
        {monthly.data && monthly.data.length === 0 && (
          <p className="muted">No usage recorded yet.</p>
        )}
      </section>
    </div>
  );
}
