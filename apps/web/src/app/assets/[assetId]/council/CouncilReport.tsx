'use client';

import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;

export function CouncilReport({ assetId }: { assetId: string }) {
  const report = trpc.council.report.useQuery({ assetId }, { refetchInterval: 5000 });

  if (report.isPending) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  if (report.isError) return <p style={{ color: 'salmon' }}>{report.error.message}</p>;

  const data = report.data;
  const escalation = data.latestGate && !data.latestGate.pass
    ? ((data.latestGate.report as { escalationNotes?: string }).escalationNotes ?? null)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p>
        <strong>{data.asset.type}</strong> — status <code>{data.asset.status}</code>
        {data.latestGate && (
          <span style={{ marginLeft: 8, color: data.latestGate.pass ? 'var(--ok)' : 'salmon' }}>
            {data.latestGate.pass ? '● G3 passed' : '■ G3 escalated'}
          </span>
        )}
      </p>

      {escalation && (
        <div style={{ ...box, borderColor: 'salmon' }}>
          <strong>Escalation — the Council could not converge in 3 loops:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{escalation}</pre>
        </div>
      )}

      {data.versions.map((v) => (
        <div key={v.versionId} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong>Version {v.version}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem' }}>
            {v.reviews.map((r) => {
              const notes = r.notes as { top_fixes?: string[]; line_notes?: { block_id: string; note: string }[] } | null;
              return (
                <div key={r.lens} style={{ ...box, padding: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{r.lens}</strong>
                    <span style={{ color: r.verdict === 'pass' ? 'var(--ok)' : 'salmon' }}>{r.score}</span>
                  </div>
                  {notes?.top_fixes?.map((f, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>
                      fix: {f}
                    </div>
                  ))}
                  {notes?.line_notes?.map((n, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>
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
        <p style={{ color: 'var(--muted)' }}>No council reviews yet for this asset.</p>
      )}
    </div>
  );
}
