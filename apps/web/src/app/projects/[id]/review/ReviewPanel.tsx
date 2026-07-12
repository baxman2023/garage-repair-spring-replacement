'use client';

import { trpc } from '@/trpc/react';

export function ReviewPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const review = trpc.strategy.review.useQuery({ projectId }, { refetchInterval: 4000 });
  const regenerate = trpc.strategy.regenerateMarket.useMutation();
  const approve = trpc.strategy.approve.useMutation({
    onSuccess: () => void utils.strategy.review.invalidate({ projectId }),
  });

  const data = review.data;
  const allDiagnosed = (data?.markets.length ?? 0) === 5 && data!.markets.every((m) => m.diagnosed);

  return (
    <div className="stack">
      <section className="row-lg">
        {data?.g2.approved ? (
          <span className="ok" style={{ fontWeight: 600 }}>
            ● G2 approved — snapshot {data.g2.approvedHash?.slice(0, 12)}… Build unlocked.
          </span>
        ) : data?.g2.stale ? (
          <span className="warn">
            ⚠ Markets changed since approval — re-approve to unlock the build.
          </span>
        ) : (
          <span className="muted">G2 pending — review all five markets, then approve.</span>
        )}
        <button
          onClick={() => approve.mutate({ projectId })}
          disabled={approve.isPending || !allDiagnosed || data?.g2.approved}
          className="btn btn-primary"
        >
          {approve.isPending ? 'Approving…' : data?.g2.stale ? 'Re-approve strategy (G2)' : 'Approve strategy (G2)'}
        </button>
        {approve.isError && <span className="danger small">{approve.error.message}</span>}
      </section>

      <section className="grid-2">
        {data?.markets.map((m) => {
          const p = m.profile as {
            awareness_stage?: string;
            awareness_justification?: string;
            sophistication?: number;
            sophistication_justification?: string;
            resident_emotion?: string;
            entry_conversation?: string;
            objections?: string[];
          } | null;
          return (
            <div key={m.id} className="card stack-sm">
              <div className="spread">
                <strong>
                  #{m.rank} {m.label}
                </strong>
                <span className="muted">
                  {m.scoreTotal !== null ? `${m.scoreTotal}/100` : ''}
                </span>
              </div>
              {m.diagnosed && p ? (
                <>
                  <div className="small">
                    <span style={{ color: 'var(--accent)' }}>{p.awareness_stage}</span> —{' '}
                    <span className="muted">{p.awareness_justification}</span>
                  </div>
                  <div className="small">
                    soph {p.sophistication}/5 —{' '}
                    <span className="muted">{p.sophistication_justification}</span>
                  </div>
                  <div className="small">
                    <em>“{p.entry_conversation}”</em>
                  </div>
                  <div className="muted xsmall">
                    emotion: {p.resident_emotion} · {p.objections?.length ?? 0} objections
                  </div>
                </>
              ) : (
                <span className="danger small">not diagnosed yet</span>
              )}
              <div className="muted xsmall">
                VOC: {m.vocCount} phrase(s)
                {m.vocHighlights.map((v, i) => (
                  <div key={i}>· “{v.phrase}”</div>
                ))}
              </div>
              <div style={{ marginTop: 'auto' }}>
                <button
                  onClick={() => regenerate.mutate({ projectId, marketId: m.id })}
                  disabled={regenerate.isPending}
                  className="btn"
                >
                  Regenerate diagnosis
                </button>
              </div>
            </div>
          );
        })}
      </section>
      {regenerate.isError && <p className="alert alert-danger">{regenerate.error.message}</p>}
      {(data?.markets.length ?? 0) === 0 && (
        <p className="muted">No markets yet — run Market Selection first.</p>
      )}
    </div>
  );
}
