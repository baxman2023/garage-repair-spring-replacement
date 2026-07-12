'use client';

import { useState } from 'react';
import { COMPLIANCE_DISCLAIMER } from '@copyforge/core';
import { trpc } from '@/trpc/react';

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
      <div key={key} className="card stack-sm">
        <div>
          {ackable && (
            <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} style={{ marginRight: 8 }} />
          )}
          <span className={f.severity === 'error' ? 'badge badge-danger' : 'badge badge-warn'}>
            [{f.severity}] {f.ruleId}
          </span>
        </div>
        <div className="small">
          <code>{f.blockId}</code> — “{f.excerpt}”
        </div>
        <div className="muted small">{f.description}</div>
      </div>
    );
  };

  return (
    <div className="stack">
      <section className="row-lg">
        <button onClick={() => run.mutate({ assetId })} disabled={run.isPending} className="btn btn-primary">
          {run.isPending ? 'Queued…' : 'Run compliance (G6)'}
        </button>
        {latest.data?.report && (
          <span className={latest.data.report.pass ? 'badge badge-ok' : 'badge badge-danger'}>
            {latest.data.report.pass ? '● G6 PASS' : '✕ G6 FAIL'}
          </span>
        )}
        {detail && <span className="muted">mode: {detail.mode}</span>}
        {detail?.disclaimerInserted && (
          <span className="warn">required disclaimer auto-inserted</span>
        )}
      </section>

      {latest.data?.report && (
        <p className="muted xsmall" style={{ margin: 0 }}>{COMPLIANCE_DISCLAIMER}</p>
      )}

      {detail?.failClosed && (
        <section className="alert alert-danger">
          <strong>Failed closed — no acknowledgment path.</strong> {detail.reason}. Resolve the
          flagged claims in the proof linker, then re-run.
        </section>
      )}

      {(detail?.errors?.length ?? 0) > 0 && (
        <section className="stack-sm">
          <strong className="danger">Errors (always block)</strong>
          {detail!.errors!.map((f) => findingRow(f, false))}
        </section>
      )}

      {(detail?.unacknowledgedWarnings?.length ?? 0) > 0 && (
        <section className="stack-sm">
          <strong className="warn">Warnings — acknowledge with a reason (audited)</strong>
          {detail!.unacknowledgedWarnings!.map((f) => findingRow(f, true))}
          <div className="row">
            <input
              placeholder="acknowledgment reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input"
              style={{ minWidth: 320 }}
            />
            <button
              onClick={() => acknowledge.mutate({ assetId, findingKeys: [...selected], reason })}
              disabled={acknowledge.isPending || selected.size === 0 || reason.trim().length < 3}
              className="btn btn-primary"
            >
              Acknowledge {selected.size} finding(s)
            </button>
          </div>
          {acknowledge.isError && <span className="danger small">{acknowledge.error.message}</span>}
        </section>
      )}

      {(detail?.acknowledgedWarnings?.length ?? 0) > 0 && (
        <section className="muted small">
          {detail!.acknowledgedWarnings!.length} warning(s) acknowledged for this version.
        </section>
      )}

      {!latest.data?.report && !latest.isLoading && (
        <p className="muted">No G6 run yet for this asset.</p>
      )}
    </div>
  );
}
