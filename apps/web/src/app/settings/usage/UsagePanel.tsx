'use client';

import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;
const th = { textAlign: 'left', padding: '0.3rem 0.6rem', color: 'var(--muted)', fontWeight: 400 } as const;
const td = { padding: '0.3rem 0.6rem' } as const;

const n = (x: number) => x.toLocaleString('en-US');
const usd = (x: number) => `$${x.toFixed(4)}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function TotalsRow({ label, u }: { label: string; u: { calls: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; costEstUsd: number; cacheHitRate: number } }) {
  return (
    <tr style={{ borderTop: '1px solid #262a33' }}>
      <td style={td}>{label}</td>
      <td style={td}>{n(u.calls)}</td>
      <td style={td}>{n(u.inputTokens)}</td>
      <td style={td}>{n(u.cacheReadTokens)}</td>
      <td style={td}>{n(u.outputTokens)}</td>
      <td style={{ ...td, color: u.cacheHitRate > 0.5 ? 'var(--ok)' : 'inherit' }}>{pct(u.cacheHitRate)}</td>
      <td style={td}>{usd(u.costEstUsd)}</td>
    </tr>
  );
}

const HEADERS = ['', 'Calls', 'Input', 'Cache read', 'Output', 'Cache hit', 'Est. cost'];

export function UsagePanel() {
  const ws = trpc.usage.workspace.useQuery(undefined, { refetchInterval: 15_000 });
  const monthly = trpc.usage.monthly.useQuery(undefined, { refetchInterval: 60_000 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={box}>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: 16 }}>This workspace</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead><tr>{HEADERS.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {ws.data && <TotalsRow label="Total" u={ws.data.total} />}
              {(ws.data?.perProject ?? []).map((p) => (
                <TotalsRow key={p.projectId ?? 'none'} label={p.projectName} u={p.usage} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={box}>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: 16 }}>Monthly summary</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead><tr>{HEADERS.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {(monthly.data ?? []).map((m) => (
                <TotalsRow key={m.month} label={m.month} u={m.usage} />
              ))}
            </tbody>
          </table>
        </div>
        {monthly.data && monthly.data.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No usage recorded yet.</p>
        )}
      </section>
    </div>
  );
}
