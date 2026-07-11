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

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  pending: { glyph: '·', color: 'var(--muted)' },
  running: { glyph: '◐', color: '#f0c674' },
  done: { glyph: '●', color: 'var(--ok)' },
  failed: { glyph: '✕', color: 'salmon' },
  skipped: { glyph: '–', color: 'var(--muted)' },
};

export function BuildPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const status = trpc.build.status.useQuery({ projectId }, { refetchInterval: 3000 });
  const invalidate = () => void utils.build.status.invalidate({ projectId });
  const start = trpc.build.start.useMutation({ onSuccess: invalidate });
  const cancel = trpc.build.cancel.useMutation({ onSuccess: invalidate });
  const resume = trpc.build.resume.useMutation({ onSuccess: invalidate });

  const data = status.data;
  const steps = data?.steps ?? [];
  const assetTypes = [...new Set(steps.map((s) => s.assetType))];
  const marketIds = [...new Set(steps.map((s) => s.marketId))];
  const cell = new Map(steps.map((s) => [`${s.marketId}:${s.assetType}`, s]));
  const marketOf = (id: string) => steps.find((s) => s.marketId === id)?.market;
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const failed = steps.filter((s) => s.status === 'failed');
  const running = data?.build.status === 'running';
  // Pre-fan-out cost estimate (WO-053): the full build is 5 markets × 8 assets.
  const estimate = trpc.usage.buildEstimate.useQuery(
    { marketCount: 5, assetTypeCount: 8 },
    { enabled: !running },
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => start.mutate({ projectId })}
          disabled={start.isPending || running}
          style={{ ...btn, opacity: running ? 0.5 : 1 }}
        >
          {start.isPending ? 'Starting…' : 'Build All (5 markets × full funnel)'}
        </button>
        {!running && estimate.data && (
          <span style={{ color: 'var(--muted)', fontSize: 13 }} title={estimate.data.note}>
            est. ~${estimate.data.totalCostUsd.toFixed(2)} for {estimate.data.plannedAssets} assets on your key (
            {estimate.data.basis === 'defaults' ? 'default averages' : 'your history'})
          </span>
        )}
        {data && running && (
          <button onClick={() => cancel.mutate({ projectId, buildId: data.build.id })} style={subtle}>
            Cancel build
          </button>
        )}
        {data && !running && data.build.status !== 'done' && (
          <button onClick={() => resume.mutate({ projectId, buildId: data.build.id })} style={subtle}>
            Resume from failure
          </button>
        )}
        {data && (
          <span style={{ color: 'var(--muted)' }}>
            {data.build.status} — {doneCount}/{steps.length} steps
          </span>
        )}
        {start.isError && <span style={{ color: 'salmon' }}>{start.error.message}</span>}
        {resume.isError && <span style={{ color: 'salmon' }}>{resume.error.message}</span>}
      </section>

      {steps.length > 0 && (
        <section style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.3rem 0.6rem' }}>Market</th>
                {assetTypes.map((t) => (
                  <th key={t} style={{ padding: '0.3rem 0.6rem', color: 'var(--muted)', fontWeight: 400 }}>
                    {t.replace(/_/g, ' ')}
                  </th>
                ))}
                <th style={{ padding: '0.3rem 0.6rem', color: 'var(--muted)', fontWeight: 400 }}>cache hit</th>
              </tr>
            </thead>
            <tbody>
              {marketIds.map((mid) => {
                const m = marketOf(mid);
                const rate = data?.cache.perMarket.find((c) => c.marketId === mid)?.hitRate ?? 0;
                return (
                  <tr key={mid} style={{ borderTop: '1px solid #262a33' }}>
                    <td style={{ padding: '0.3rem 0.6rem' }}>
                      #{m?.rank} {m?.label}
                    </td>
                    {assetTypes.map((t) => {
                      const s = cell.get(`${mid}:${t}`);
                      const g = STATUS_GLYPH[s?.status ?? 'pending']!;
                      return (
                        <td key={t} title={s?.error ?? s?.status} style={{ textAlign: 'center', color: g.color }}>
                          {g.glyph}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', color: rate > 0.5 ? 'var(--ok)' : 'var(--muted)' }}>
                      {(rate * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            overall cache hit rate {(data!.cache.overall.hitRate * 100).toFixed(0)}% (
            {data!.cache.overall.cacheReadTokens.toLocaleString()} cached /{' '}
            {(data!.cache.overall.inputTokens + data!.cache.overall.cacheReadTokens).toLocaleString()} input
            tokens) — second market onward should ride the warm genome + council blocks.
          </p>
        </section>
      )}

      {failed.length > 0 && (
        <section style={{ color: 'salmon', fontSize: 13 }}>
          {failed.map((s) => (
            <div key={s.seq}>
              step {s.seq} — {s.assetType} @ #{s.market?.rank}: {s.error}
            </div>
          ))}
        </section>
      )}

      {!data && !status.isLoading && (
        <p style={{ color: 'var(--muted)' }}>No build yet — approve G2, then Build All.</p>
      )}
    </div>
  );
}
