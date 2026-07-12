'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

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
        color: !c ? 'var(--muted)' : c.pass ? 'var(--ok)' : 'var(--danger)',
      }}
    >
      {!c ? '·' : c.overridden ? '◉' : c.pass ? '●' : '✕'}
    </td>
  );

  return (
    <div className="stack">
      <section className="row">
        <span className="muted small">{selected.size} selected —</span>
        <input
          placeholder="reason (required for block/override)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input"
          style={{ minWidth: 260 }}
        />
        <select value={overrideGate} onChange={(e) => setOverrideGate(e.target.value as Gate)} className="select">
          {(['G3', 'G4', 'G5', 'G6', 'G7'] as Gate[]).map((g) => (
            <option key={g} value={g}>
              override {g}
            </option>
          ))}
        </select>
        <button
          onClick={() => override.mutate({ assetIds: [...selected], gate: overrideGate, reason })}
          disabled={override.isPending || selected.size === 0 || reason.trim().length < 3}
          className="btn btn-primary btn-sm"
        >
          Override (owner)
        </button>
        <button
          onClick={() => block.mutate({ assetIds: [...selected], reason })}
          disabled={block.isPending || selected.size === 0 || reason.trim().length < 3}
          className="btn btn-danger btn-sm"
        >
          Block
        </button>
        <button
          onClick={() => approve.mutate({ assetIds: [...selected] })}
          disabled={approve.isPending || selected.size === 0}
          className="btn btn-primary btn-sm"
        >
          Approve
        </button>
        {(override.isError || block.isError || approve.isError) && (
          <span className="danger small">
            {override.error?.message ?? block.error?.message ?? approve.error?.message}
          </span>
        )}
      </section>

      <section>
        <div className="table-wrap">
          <table style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th />
                <th>Market</th>
                <th>Asset</th>
                <th>Status</th>
                {data?.gates.map((g) => (
                  <th key={g}>{g}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.assetId}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.assetId)} onChange={() => toggle(r.assetId)} />
                  </td>
                  <td>
                    {r.market ? `#${r.market.rank} ${r.market.label}` : '—'}
                  </td>
                  <td>{r.assetType.replace(/_/g, ' ')}</td>
                  <td>
                    <span className={r.status === 'blocked' ? 'badge badge-danger' : 'badge'}>{r.status}</span>
                  </td>
                  {(['G3', 'G4', 'G5', 'G6', 'G7'] as Gate[]).map((g) => cell(r.assetId, g, r.gates[g]))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data?.rows.length ?? 0) === 0 && !grid.isLoading && (
          <p className="muted">No assets yet — run a build first.</p>
        )}
      </section>

      {drill && (
        <section className="card">
          <div className="spread">
            <strong>
              {drill.gate} report — asset {drill.assetId.slice(-8)}
            </strong>
            <button onClick={() => setDrill(null)} className="btn btn-sm">
              close
            </button>
          </div>
          {report.data && (
            <>
              <p className={report.data.pass ? 'ok' : 'danger'}>
                {report.data.pass ? 'PASS' : 'FAIL'}
                {report.data.overriddenBy && (
                  <span className="warn">
                    {' '}
                    — OVERRIDDEN: “{report.data.overrideReason}”
                  </span>
                )}
              </p>
              <pre className="xsmall" style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(report.data.report, null, 2)}
              </pre>
            </>
          )}
        </section>
      )}
    </div>
  );
}
