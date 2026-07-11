'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;
const btn = {
  padding: '0.45rem 0.85rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

interface Finding {
  ruleId: string;
  pack: string;
  severity: 'error' | 'warning';
  blockId: string;
  excerpt: string;
  description: string;
}

export function CompliancePanel({ assetId }: { assetId: string }) {
  const utils = trpc.useUtils();
  const latest = trpc.compliance.latest.useQuery({ assetId }, { refetchInterval: 4000 });
  const invalidate = () => void utils.compliance.latest.invalidate({ assetId });
  const run = trpc.compliance.run.useMutation({ onSuccess: invalidate });
  const acknowledge = trpc.compliance.acknowledge.useMutation({ onSuccess: invalidate });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  const detail = latest.data?.report?.detail as
    | {
        mode: string;
        failClosed?: boolean;
        reason?: string;
        errors?: Finding[];
        unacknowledgedWarnings?: Finding[];
        acknowledgedWarnings?: Finding[];
        disclaimerInserted?: boolean;
        flagReport?: { flagged: number };
      }
    | undefined;

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const findingRow = (f: Finding, ackable: boolean) => {
    const key = `${f.ruleId}:${f.blockId}`;
    return (
      <div key={key} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div>
          {ackable && (
            <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} style={{ marginRight: 8 }} />
          )}
          <span style={{ color: f.severity === 'error' ? 'salmon' : '#f0c674', fontWeight: 600 }}>
            [{f.severity}] {f.ruleId}
          </span>
        </div>
        <div style={{ fontSize: 13 }}>
          <code>{f.blockId}</code> — “{f.excerpt}”
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{f.description}</div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => run.mutate({ assetId })} disabled={run.isPending} style={btn}>
          {run.isPending ? 'Queued…' : 'Run compliance (G6)'}
        </button>
        {latest.data?.report && (
          <span style={{ color: latest.data.report.pass ? 'var(--ok)' : 'salmon', fontWeight: 600 }}>
            {latest.data.report.pass ? '● G6 PASS' : '✕ G6 FAIL'}
          </span>
        )}
        {detail && <span style={{ color: 'var(--muted)' }}>mode: {detail.mode}</span>}
        {detail?.disclaimerInserted && (
          <span style={{ color: '#f0c674' }}>required disclaimer auto-inserted</span>
        )}
      </section>

      {detail?.failClosed && (
        <section style={{ ...box, color: 'salmon' }}>
          <strong>Failed closed — no acknowledgment path.</strong> {detail.reason}. Resolve the
          flagged claims in the proof linker, then re-run.
        </section>
      )}

      {(detail?.errors?.length ?? 0) > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong style={{ color: 'salmon' }}>Errors (always block)</strong>
          {detail!.errors!.map((f) => findingRow(f, false))}
        </section>
      )}

      {(detail?.unacknowledgedWarnings?.length ?? 0) > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong style={{ color: '#f0c674' }}>Warnings — acknowledge with a reason (audited)</strong>
          {detail!.unacknowledgedWarnings!.map((f) => findingRow(f, true))}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              placeholder="acknowledgment reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ ...subtle, cursor: 'text', minWidth: 320 }}
            />
            <button
              onClick={() => acknowledge.mutate({ assetId, findingKeys: [...selected], reason })}
              disabled={acknowledge.isPending || selected.size === 0 || reason.trim().length < 3}
              style={btn}
            >
              Acknowledge {selected.size} finding(s)
            </button>
          </div>
          {acknowledge.isError && <span style={{ color: 'salmon' }}>{acknowledge.error.message}</span>}
        </section>
      )}

      {(detail?.acknowledgedWarnings?.length ?? 0) > 0 && (
        <section style={{ fontSize: 13, color: 'var(--muted)' }}>
          {detail!.acknowledgedWarnings!.length} warning(s) acknowledged for this version.
        </section>
      )}

      {!latest.data?.report && !latest.isLoading && (
        <p style={{ color: 'var(--muted)' }}>No G6 run yet for this asset.</p>
      )}
    </div>
  );
}
