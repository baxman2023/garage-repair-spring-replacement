'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

function CopyButton({ label, getText }: { label: string; getText: () => Promise<string | null> }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  return (
    <button
      className="btn btn-primary btn-sm"
      onClick={async () => {
        try {
          const text = await getText();
          if (!text) throw new Error('empty');
          await navigator.clipboard.writeText(text);
          setState('copied');
        } catch {
          setState('error');
        }
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'copied' ? '✓ Copied' : state === 'error' ? 'Unavailable' : label}
    </button>
  );
}

export function DeliveryPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const overview = trpc.delivery.overview.useQuery({ projectId }, { refetchInterval: 6000 });
  const marketZip = trpc.delivery.marketZip.useMutation();
  const quizDeploy = trpc.quiz.deploy.useQuery({ projectId }, { retry: false });
  const regen = trpc.assets.regenerateBlock.useMutation();
  const [regenTarget, setRegenTarget] = useState<Record<string, string>>({});

  const data = overview.data;
  if (!data) return overview.isLoading ? null : <p className="muted">No data.</p>;

  const promptText = async (assetId: string, kind: 'macaly' | 'universal') => {
    const pkg = await utils.packages.latest.fetch({ assetId });
    return kind === 'macaly' ? (pkg.package?.macalyPrompt ?? null) : (pkg.package?.universalPrompt ?? null);
  };
  const snippetText = async (assetId: string) => {
    const s = await utils.messageMatch.snippet.fetch({ assetId });
    return s.snippet;
  };

  const downloadZip = async (marketId: string) => {
    const result = await marketZip.mutateAsync({ projectId, marketId });
    if (result.exportId) window.open(`/api/exports/download?id=${result.exportId}`, '_blank');
  };

  return (
    <div className="stack">
      {/* Quiz deploy surface */}
      {quizDeploy.data && (
        <section className="card row-lg">
          <strong>Quiz</strong>
          <a href={quizDeploy.data.hostedUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            {quizDeploy.data.hostedUrl}
          </a>
          <CopyButton label="Copy hosted link" getText={async () => quizDeploy.data!.hostedUrl} />
          <CopyButton label="Copy single-file embed" getText={async () => quizDeploy.data!.singleFileHtml} />
          <span className="muted xsmall">
            {quizDeploy.data.metrics.starts} starts · {quizDeploy.data.metrics.completes} completes ·{' '}
            {quizDeploy.data.metrics.optins} optins
          </span>
        </section>
      )}

      {/* Congruence flag strip */}
      {data.congruence.flagged.length > 0 && (
        <section className="alert alert-warn small">
          ⚠ {data.congruence.flagged.length} tagged ad(s) with no mapped variant:{' '}
          {data.congruence.flagged.map((f) => f.utmContent).join(', ')} — package their target assets to seed the maps.
        </section>
      )}

      {/* Per-market asset delivery */}
      {data.markets.map((market) => {
        const assets = data.assets.filter((a) => a.marketId === market.id);
        if (assets.length === 0) return null;
        return (
          <section key={market.id} className="stack-sm">
            <div className="row-lg">
              <h2>
                #{market.rank} {market.label}
              </h2>
              <button onClick={() => void downloadZip(market.id)} disabled={marketZip.isPending} className="btn btn-sm">
                {marketZip.isPending ? 'Zipping…' : 'Download market ZIP'}
              </button>
            </div>
            {assets.map((a) => (
              <div key={a.assetId} className="card stack-sm">
                <div className="row">
                  <strong>{a.type.replace(/_/g, ' ')}</strong>
                  <span className={a.status === 'blocked' ? 'badge badge-danger' : 'badge'}>
                    {a.status}
                  </span>
                  {a.package && (
                    <span className={a.package.g7Pass ? 'ok xsmall' : 'warn xsmall'}>
                      {a.package.g7Pass ? '● G7 complete' : '◐ package incomplete'}
                    </span>
                  )}
                  {a.package?.hasMacaly && (
                    <CopyButton label="Copy Macaly prompt" getText={() => promptText(a.assetId, 'macaly')} />
                  )}
                  {a.package?.hasUniversal && (
                    <CopyButton label="Copy universal prompt" getText={() => promptText(a.assetId, 'universal')} />
                  )}
                  <CopyButton label="Copy MM snippet" getText={() => snippetText(a.assetId)} />
                  <input
                    placeholder="block id"
                    value={regenTarget[a.assetId] ?? ''}
                    onChange={(e) => setRegenTarget((s) => ({ ...s, [a.assetId]: e.target.value }))}
                    className="input"
                    style={{ width: 110 }}
                  />
                  <button
                    onClick={() =>
                      regen.mutate({ assetId: a.assetId, blockId: (regenTarget[a.assetId] ?? '').trim() })
                    }
                    disabled={regen.isPending || !(regenTarget[a.assetId] ?? '').trim()}
                    className="btn btn-sm"
                  >
                    Regen block
                  </button>
                </div>
                <ol className="muted small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {a.nextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        );
      })}
      {regen.isError && <p className="alert alert-danger">{regen.error.message}</p>}
      {marketZip.isError && <p className="alert alert-danger">{marketZip.error.message}</p>}
    </div>
  );
}
