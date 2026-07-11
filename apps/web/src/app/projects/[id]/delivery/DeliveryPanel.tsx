'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;
const btn = {
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

function CopyButton({ label, getText }: { label: string; getText: () => Promise<string | null> }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  return (
    <button
      style={btn}
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
  if (!data) return overview.isLoading ? null : <p style={{ color: 'var(--muted)' }}>No data.</p>;

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Quiz deploy surface */}
      {quizDeploy.data && (
        <section style={{ ...box, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>Quiz</strong>
          <a href={quizDeploy.data.hostedUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            {quizDeploy.data.hostedUrl}
          </a>
          <CopyButton label="Copy hosted link" getText={async () => quizDeploy.data!.hostedUrl} />
          <CopyButton label="Copy single-file embed" getText={async () => quizDeploy.data!.singleFileHtml} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            {quizDeploy.data.metrics.starts} starts · {quizDeploy.data.metrics.completes} completes ·{' '}
            {quizDeploy.data.metrics.optins} optins
          </span>
        </section>
      )}

      {/* Congruence flag strip */}
      {data.congruence.flagged.length > 0 && (
        <section style={{ ...box, color: '#f0c674', fontSize: 13 }}>
          ⚠ {data.congruence.flagged.length} tagged ad(s) with no mapped variant:{' '}
          {data.congruence.flagged.map((f) => f.utmContent).join(', ')} — package their target assets to seed the maps.
        </section>
      )}

      {/* Per-market asset delivery */}
      {data.markets.map((market) => {
        const assets = data.assets.filter((a) => a.marketId === market.id);
        if (assets.length === 0) return null;
        return (
          <section key={market.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.05rem' }}>
                #{market.rank} {market.label}
              </h2>
              <button onClick={() => void downloadZip(market.id)} disabled={marketZip.isPending} style={subtle}>
                {marketZip.isPending ? 'Zipping…' : 'Download market ZIP'}
              </button>
            </div>
            {assets.map((a) => (
              <div key={a.assetId} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{a.type.replace(/_/g, ' ')}</strong>
                  <span style={{ color: a.status === 'blocked' ? 'salmon' : 'var(--muted)', fontSize: 12 }}>
                    {a.status}
                  </span>
                  {a.package && (
                    <span style={{ color: a.package.g7Pass ? 'var(--ok)' : '#f0c674', fontSize: 12 }}>
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
                    style={{ ...subtle, cursor: 'text', width: 110 }}
                  />
                  <button
                    onClick={() =>
                      regen.mutate({ assetId: a.assetId, blockId: (regenTarget[a.assetId] ?? '').trim() })
                    }
                    disabled={regen.isPending || !(regenTarget[a.assetId] ?? '').trim()}
                    style={subtle}
                  >
                    Regen block
                  </button>
                </div>
                <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 13, color: 'var(--muted)' }}>
                  {a.nextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        );
      })}
      {regen.isError && <p style={{ color: 'salmon' }}>{regen.error.message}</p>}
      {marketZip.isError && <p style={{ color: 'salmon' }}>{marketZip.error.message}</p>}
    </div>
  );
}
