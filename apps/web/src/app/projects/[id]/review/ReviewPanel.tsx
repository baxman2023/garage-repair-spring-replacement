'use client';

import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {data?.g2.approved ? (
          <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
            ● G2 approved — snapshot {data.g2.approvedHash?.slice(0, 12)}… Build unlocked.
          </span>
        ) : data?.g2.stale ? (
          <span style={{ color: '#f0c674' }}>
            ⚠ Markets changed since approval — re-approve to unlock the build.
          </span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>G2 pending — review all five markets, then approve.</span>
        )}
        <button
          onClick={() => approve.mutate({ projectId })}
          disabled={approve.isPending || !allDiagnosed || data?.g2.approved}
          style={{ ...btn, opacity: allDiagnosed && !data?.g2.approved ? 1 : 0.5 }}
        >
          {approve.isPending ? 'Approving…' : data?.g2.stale ? 'Re-approve strategy (G2)' : 'Approve strategy (G2)'}
        </button>
        {approve.isError && <span style={{ color: 'salmon' }}>{approve.error.message}</span>}
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '0.75rem',
        }}
      >
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
            <div key={m.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>
                  #{m.rank} {m.label}
                </strong>
                <span style={{ color: 'var(--muted)' }}>
                  {m.scoreTotal !== null ? `${m.scoreTotal}/100` : ''}
                </span>
              </div>
              {m.diagnosed && p ? (
                <>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--accent)' }}>{p.awareness_stage}</span> —{' '}
                    <span style={{ color: 'var(--muted)' }}>{p.awareness_justification}</span>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    soph {p.sophistication}/5 —{' '}
                    <span style={{ color: 'var(--muted)' }}>{p.sophistication_justification}</span>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <em>“{p.entry_conversation}”</em>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    emotion: {p.resident_emotion} · {p.objections?.length ?? 0} objections
                  </div>
                </>
              ) : (
                <span style={{ color: 'salmon', fontSize: 13 }}>not diagnosed yet</span>
              )}
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                VOC: {m.vocCount} phrase(s)
                {m.vocHighlights.map((v, i) => (
                  <div key={i}>· “{v.phrase}”</div>
                ))}
              </div>
              <div style={{ marginTop: 'auto' }}>
                <button
                  onClick={() => regenerate.mutate({ projectId, marketId: m.id })}
                  disabled={regenerate.isPending}
                  style={subtle}
                >
                  Regenerate diagnosis
                </button>
              </div>
            </div>
          );
        })}
      </section>
      {regenerate.isError && <p style={{ color: 'salmon' }}>{regenerate.error.message}</p>}
      {(data?.markets.length ?? 0) === 0 && (
        <p style={{ color: 'var(--muted)' }}>No markets yet — run Market Selection first.</p>
      )}
    </div>
  );
}
