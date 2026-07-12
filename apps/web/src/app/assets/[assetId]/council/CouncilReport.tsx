'use client';

import { trpc } from '@/trpc/react';

export function CouncilReport({ assetId }: { assetId: string }) {
  const report = trpc.council.report.useQuery({ assetId }, { refetchInterval: 5000 });

  if (report.isPending) return <p className="muted">Loading…</p>;
  if (report.isError) return <p className="alert alert-danger">{report.error.message}</p>;

  const data = report.data;
  const escalation = data.latestGate && !data.latestGate.pass
    ? ((data.latestGate.report as { escalationNotes?: string }).escalationNotes ?? null)
    : null;

  return (
    <div className="stack">
      <p>
        <strong>{data.asset.type}</strong> — status <code>{data.asset.status}</code>
        {data.latestGate && (
          <span
            className={data.latestGate.pass ? 'badge badge-ok' : 'badge badge-danger'}
            style={{ marginLeft: 8 }}
          >
            {data.latestGate.pass ? '● G3 passed' : '■ G3 escalated'}
          </span>
        )}
      </p>

      {escalation && (
        <div className="alert alert-danger">
          <strong>Escalation — the Council could not converge in 3 loops:</strong>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{escalation}</pre>
        </div>
      )}

      {data.versions.map((v) => (
        <div key={v.versionId} className="card stack-sm">
          <strong>Version {v.version}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem' }}>
            {v.reviews.map((r) => {
              const notes = r.notes as { top_fixes?: string[]; line_notes?: { block_id: string; note: string }[] } | null;
              return (
                <div key={r.lens} className="card" style={{ padding: '0.5rem' }}>
                  <div className="spread">
                    <strong>{r.lens}</strong>
                    <span className={r.verdict === 'pass' ? 'ok' : 'danger'}>{r.score}</span>
                  </div>
                  {notes?.top_fixes?.map((f, i) => (
                    <div key={i} className="muted xsmall">
                      fix: {f}
                    </div>
                  ))}
                  {notes?.line_notes?.map((n, i) => (
                    <div key={i} className="muted xsmall">
                      [{n.block_id}] {n.note}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {data.versions.length === 0 && (
        <p className="muted">No council reviews yet for this asset.</p>
      )}
    </div>
  );
}
