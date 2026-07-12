'use client';

import { trpc } from '@/trpc/react';

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
    <div className="stack">
      <section className="row-lg">
        <button onClick={() => run.mutate({ assetId })} disabled={run.isPending} className="btn btn-primary">
          {run.isPending ? 'Queued…' : data?.run ? 'Re-run focus group' : 'Run focus group (G4)'}
        </button>
        {data?.run && !data.run.pass && (
          <button onClick={() => fix.mutate({ assetId })} disabled={fix.isPending} className="btn btn-primary">
            {fix.isPending ? 'Queued…' : 'Fix annotations (one click)'}
          </button>
        )}
        {data?.run && (
          <button onClick={() => void download()} className="btn">
            Export report (.md)
          </button>
        )}
        {run.isError && <span className="danger small">{run.error.message}</span>}
        {fix.isError && <span className="danger small">{fix.error.message}</span>}
      </section>

      {data?.run && report && (
        <>
          <section className="row-lg">
            <div className="card">
              <span className={data.run.pass ? 'badge badge-ok' : 'badge badge-danger'}>
                {data.run.pass ? 'G4 PASS' : 'G4 FAIL'}
              </span>{' '}
              <span className="muted">(version {data.run.version})</span>
            </div>
            <div className="card">
              reached CTA: <strong>{(report.ctaReachRatio * 100).toFixed(0)}%</strong>
              <span className="muted">
                {' '}
                / need ≥ {(report.config.minCtaReachRatio * 100).toFixed(0)}%
              </span>
            </div>
            <div className="card">cohort: {report.cohortSize} personas</div>
          </section>

          {report.failures.length > 0 && (
            <section className="alert alert-danger">
              {report.failures.map((f, i) => (
                <div key={i}>✕ {f}</div>
              ))}
            </section>
          )}

          <section className="card">
            <strong>Annotations (marked-up draft)</strong>
            {report.annotations.length === 0 && <p className="muted">none</p>}
            {report.annotations.map((a, i) => (
              <div key={i} className="small" style={{ margin: '0.35rem 0' }}>
                <code>{a.blockId}</code>{' '}
                <span className={a.kind === 'disbelief' ? 'danger' : 'warn'}>[{a.kind}]</span>{' '}
                {a.note}
              </div>
            ))}
          </section>

          <section className="card">
            <strong>Spouse test</strong>
            {report.spouseQuotes.slice(0, 10).map((q, i) => (
              <div key={i} className="muted small">
                “{q}”
              </div>
            ))}
          </section>
        </>
      )}

      {!data?.run && !latest.isLoading && (
        <p className="muted">No focus-group run yet for this asset.</p>
      )}
    </div>
  );
}
