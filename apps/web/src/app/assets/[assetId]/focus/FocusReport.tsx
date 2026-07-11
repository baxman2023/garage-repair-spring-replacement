'use client';

import { trpc } from '@/trpc/react';

const btn = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;
const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;

export function FocusReport({ assetId }: { assetId: string }) {
  const utils = trpc.useUtils();
  const latest = trpc.focusGroup.latest.useQuery({ assetId }, { refetchInterval: 4000 });
  const invalidate = () => void utils.focusGroup.latest.invalidate({ assetId });
  const run = trpc.focusGroup.run.useMutation({ onSuccess: invalidate });
  const fix = trpc.focusGroup.fixAnnotations.useMutation({ onSuccess: invalidate });
  const exportQ = trpc.focusGroup.exportMarkdown.useQuery({ assetId }, { enabled: false });

  const data = latest.data;
  const report = data?.run?.report;

  const download = async () => {
    const res = await exportQ.refetch();
    if (!res.data) return;
    const blob = new Blob([res.data.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `focus-group-${assetId}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => run.mutate({ assetId })} disabled={run.isPending} style={btn}>
          {run.isPending ? 'Queued…' : data?.run ? 'Re-run focus group' : 'Run focus group (G4)'}
        </button>
        {data?.run && !data.run.pass && (
          <button onClick={() => fix.mutate({ assetId })} disabled={fix.isPending} style={btn}>
            {fix.isPending ? 'Queued…' : 'Fix annotations (one click)'}
          </button>
        )}
        {data?.run && (
          <button onClick={() => void download()} style={subtle}>
            Export report (.md)
          </button>
        )}
        {run.isError && <span style={{ color: 'salmon' }}>{run.error.message}</span>}
        {fix.isError && <span style={{ color: 'salmon' }}>{fix.error.message}</span>}
      </section>

      {data?.run && report && (
        <>
          <section style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={box}>
              <strong style={{ color: data.run.pass ? 'var(--ok)' : 'salmon' }}>
                {data.run.pass ? 'G4 PASS' : 'G4 FAIL'}
              </strong>{' '}
              <span style={{ color: 'var(--muted)' }}>(version {data.run.version})</span>
            </div>
            <div style={box}>
              reached CTA: <strong>{(report.ctaReachRatio * 100).toFixed(0)}%</strong>
              <span style={{ color: 'var(--muted)' }}>
                {' '}
                / need ≥ {(report.config.minCtaReachRatio * 100).toFixed(0)}%
              </span>
            </div>
            <div style={box}>cohort: {report.cohortSize} personas</div>
          </section>

          {report.failures.length > 0 && (
            <section style={{ color: 'salmon' }}>
              {report.failures.map((f, i) => (
                <div key={i}>✕ {f}</div>
              ))}
            </section>
          )}

          <section style={{ ...box }}>
            <strong>Annotations (marked-up draft)</strong>
            {report.annotations.length === 0 && <p style={{ color: 'var(--muted)' }}>none</p>}
            {report.annotations.map((a, i) => (
              <div key={i} style={{ fontSize: 13, margin: '0.35rem 0' }}>
                <code>{a.blockId}</code>{' '}
                <span style={{ color: a.kind === 'disbelief' ? 'salmon' : '#f0c674' }}>[{a.kind}]</span>{' '}
                {a.note}
              </div>
            ))}
          </section>

          <section style={{ ...box }}>
            <strong>Spouse test</strong>
            {report.spouseQuotes.slice(0, 10).map((q, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--muted)' }}>
                “{q}”
              </div>
            ))}
          </section>
        </>
      )}

      {!data?.run && !latest.isLoading && (
        <p style={{ color: 'var(--muted)' }}>No focus-group run yet for this asset.</p>
      )}
    </div>
  );
}
