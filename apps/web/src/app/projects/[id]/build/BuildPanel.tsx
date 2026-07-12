'use client';

import { trpc } from '@/trpc/react';

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  pending: { glyph: '·', color: 'var(--muted)' },
  running: { glyph: '◐', color: 'var(--warn)' },
  done: { glyph: '●', color: 'var(--ok)' },
  failed: { glyph: '✕', color: 'var(--danger)' },
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
    <div className="stack">
      <section className="row-lg">
        <button
          onClick={() => start.mutate({ projectId })}
          disabled={start.isPending || running}
          className="btn btn-primary"
        >
          {start.isPending ? 'Starting…' : 'Build All (5 markets × full funnel)'}
        </button>
        {!running && estimate.data && (
          <span className="muted small" title={estimate.data.note}>
            est. ~${estimate.data.totalCostUsd.toFixed(2)} for {estimate.data.plannedAssets} assets on your key (
            {estimate.data.basis === 'defaults' ? 'default averages' : 'your history'})
          </span>
        )}
        {data && running && (
          <button onClick={() => cancel.mutate({ projectId, buildId: data.build.id })} className="btn">
            Cancel build
          </button>
        )}
        {data && !running && data.build.status !== 'done' && (
          <button onClick={() => resume.mutate({ projectId, buildId: data.build.id })} className="btn">
            Resume from failure
          </button>
        )}
        {data && (
          <span className="muted">
            {data.build.status} — {doneCount}/{steps.length} steps
          </span>
        )}
        {start.isError && <span className="danger small">{start.error.message}</span>}
        {resume.isError && <span className="danger small">{resume.error.message}</span>}
      </section>

      {steps.length > 0 && (
        <section>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  {assetTypes.map((t) => (
                    <th key={t}>{t.replace(/_/g, ' ')}</th>
                  ))}
                  <th>cache hit</th>
                </tr>
              </thead>
              <tbody>
                {marketIds.map((mid) => {
                  const m = marketOf(mid);
                  const rate = data?.cache.perMarket.find((c) => c.marketId === mid)?.hitRate ?? 0;
                  return (
                    <tr key={mid}>
                      <td>
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
                      <td className={rate > 0.5 ? 'ok' : 'muted'} style={{ textAlign: 'center' }}>
                        {(rate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted xsmall">
            overall cache hit rate {(data!.cache.overall.hitRate * 100).toFixed(0)}% (
            {data!.cache.overall.cacheReadTokens.toLocaleString()} cached /{' '}
            {(data!.cache.overall.inputTokens + data!.cache.overall.cacheReadTokens).toLocaleString()} input
            tokens) — second market onward should ride the warm genome + council blocks.
          </p>
        </section>
      )}

      {failed.length > 0 && (
        <section className="alert alert-danger small">
          {failed.map((s) => (
            <div key={s.seq}>
              step {s.seq} — {s.assetType} @ #{s.market?.rank}: {s.error}
            </div>
          ))}
        </section>
      )}

      {!data && !status.isLoading && (
        <p className="muted">No build yet — approve G2, then Build All.</p>
      )}
    </div>
  );
}
