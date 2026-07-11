'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const btn = {
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;
const danger = { ...btn, background: '#8c2f39', color: '#fff' } as const;

type Gate = 'G3' | 'G4' | 'G5' | 'G6' | 'G7';

export function GatesPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  // Live: the grid polls so worker updates surface without a reload.
  const grid = trpc.gates.grid.useQuery({ projectId }, { refetchInterval: 3000 });
  const invalidate = () => void utils.gates.grid.invalidate({ projectId });
  const override = trpc.gates.override.useMutation({ onSuccess: invalidate });
  const block = trpc.gates.block.useMutation({ onSuccess: invalidate });
  const approve = trpc.gates.approve.useMutation({ onSuccess: invalidate });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [overrideGate, setOverrideGate] = useState<Gate>('G3');
  const [drill, setDrill] = useState<{ assetId: string; gate: Gate } | null>(null);
  const report = trpc.gates.report.useQuery(drill!, { enabled: drill !== null });

  const data = grid.data;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cell = (assetId: string, gate: Gate, c: { pass: boolean; overridden: boolean } | null) => (
    <td
      key={gate}
      onClick={() => c && setDrill({ assetId, gate })}
      title={c ? `${gate}: ${c.pass ? 'pass' : 'fail'}${c.overridden ? ' (override)' : ''}` : `${gate}: not run`}
      style={{
        textAlign: 'center',
        cursor: c ? 'pointer' : 'default',
        color: !c ? 'var(--muted)' : c.pass ? 'var(--ok)' : 'salmon',
      }}
    >
      {!c ? '·' : c.overridden ? '◉' : c.pass ? '●' : '✕'}
    </td>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{selected.size} selected —</span>
        <input
          placeholder="reason (required for block/override)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ ...subtle, cursor: 'text', minWidth: 260 }}
        />
        <select value={overrideGate} onChange={(e) => setOverrideGate(e.target.value as Gate)} style={subtle}>
          {(['G3', 'G4', 'G5', 'G6', 'G7'] as Gate[]).map((g) => (
            <option key={g} value={g}>
              override {g}
            </option>
          ))}
        </select>
        <button
          onClick={() => override.mutate({ assetIds: [...selected], gate: overrideGate, reason })}
          disabled={override.isPending || selected.size === 0 || reason.trim().length < 3}
          style={btn}
        >
          Override (owner)
        </button>
        <button
          onClick={() => block.mutate({ assetIds: [...selected], reason })}
          disabled={block.isPending || selected.size === 0 || reason.trim().length < 3}
          style={danger}
        >
          Block
        </button>
        <button
          onClick={() => approve.mutate({ assetIds: [...selected] })}
          disabled={approve.isPending || selected.size === 0}
          style={btn}
        >
          Approve
        </button>
        {(override.isError || block.isError || approve.isError) && (
          <span style={{ color: 'salmon' }}>
            {override.error?.message ?? block.error?.message ?? approve.error?.message}
          </span>
        )}
      </section>

      <section style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr>
              <th />
              <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Market</th>
              <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Asset</th>
              <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Status</th>
              {data?.gates.map((g) => (
                <th key={g} style={{ padding: '0.3rem 0.5rem', color: 'var(--muted)', fontWeight: 400 }}>
                  {g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.assetId} style={{ borderTop: '1px solid #262a33' }}>
                <td>
                  <input type="checkbox" checked={selected.has(r.assetId)} onChange={() => toggle(r.assetId)} />
                </td>
                <td style={{ padding: '0.3rem 0.5rem' }}>
                  {r.market ? `#${r.market.rank} ${r.market.label}` : '—'}
                </td>
                <td style={{ padding: '0.3rem 0.5rem' }}>{r.assetType.replace(/_/g, ' ')}</td>
                <td style={{ padding: '0.3rem 0.5rem', color: r.status === 'blocked' ? 'salmon' : 'var(--muted)' }}>
                  {r.status}
                </td>
                {(['G3', 'G4', 'G5', 'G6', 'G7'] as Gate[]).map((g) => cell(r.assetId, g, r.gates[g]))}
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.rows.length ?? 0) === 0 && !grid.isLoading && (
          <p style={{ color: 'var(--muted)' }}>No assets yet — run a build first.</p>
        )}
      </section>

      {drill && (
        <section
          style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid #333', background: '#12151c' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>
              {drill.gate} report — asset {drill.assetId.slice(-8)}
            </strong>
            <button onClick={() => setDrill(null)} style={subtle}>
              close
            </button>
          </div>
          {report.data && (
            <>
              <p style={{ color: report.data.pass ? 'var(--ok)' : 'salmon' }}>
                {report.data.pass ? 'PASS' : 'FAIL'}
                {report.data.overriddenBy && (
                  <span style={{ color: '#f0c674' }}>
                    {' '}
                    — OVERRIDDEN: “{report.data.overrideReason}”
                  </span>
                )}
              </p>
              <pre style={{ fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(report.data.report, null, 2)}
              </pre>
            </>
          )}
        </section>
      )}
    </div>
  );
}
