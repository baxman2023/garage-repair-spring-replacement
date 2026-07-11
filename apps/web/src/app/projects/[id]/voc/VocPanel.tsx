'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.5rem',
  borderRadius: 6,
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

const KIND_COLORS: Record<string, string> = {
  pain: 'salmon',
  desire: 'var(--ok)',
  objection: '#f0c674',
  identity: 'var(--accent)',
};

export function VocPanel({ projectId }: { projectId: string }) {
  const markets = trpc.markets.list.useQuery({ projectId });
  const [marketId, setMarketId] = useState<string | null>(null);
  const activeMarket = marketId ?? markets.data?.[0]?.id ?? null;

  const corpus = trpc.voc.corpus.useQuery(
    { projectId, marketId: activeMarket! },
    { enabled: Boolean(activeMarket), refetchInterval: 4000 },
  );
  const addSource = trpc.voc.addSource.useMutation({
    onSuccess: () => {
      setPaste('');
      setUrl('');
    },
  });

  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');

  const phrases = corpus.data?.phrases ?? [];
  const byKind = ['pain', 'desire', 'objection', 'identity'].map((kind) => ({
    kind,
    items: phrases.filter((p) => p.kind === kind),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {markets.data?.map((m) => (
          <button
            key={m.id}
            onClick={() => setMarketId(m.id)}
            style={{
              ...box,
              cursor: 'pointer',
              borderColor: m.id === activeMarket ? 'var(--accent)' : '#333',
            }}
          >
            #{m.rank} {m.label}
          </button>
        ))}
        {markets.data?.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>Select markets first (Market Selection).</p>
        )}
      </section>

      {activeMarket && (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 720 }}>
            <h3 style={{ margin: 0 }}>Add sources</h3>
            <textarea
              rows={5}
              placeholder="Paste reviews, threads, comments…"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              style={{ ...box, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() =>
                  addSource.mutate({ projectId, marketId: activeMarket, kind: 'paste', content: paste })
                }
                disabled={addSource.isPending || !paste.trim()}
                style={btn}
              >
                Mine paste
              </button>
              <input
                placeholder="https://reviews-page…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{ ...box, minWidth: 280 }}
              />
              <button
                onClick={() => addSource.mutate({ projectId, marketId: activeMarket, kind: 'url', url })}
                disabled={addSource.isPending || !url.trim()}
                style={btn}
              >
                Mine URL
              </button>
            </div>
            {addSource.isSuccess && (
              <p style={{ color: 'var(--ok)' }}>Mining queued — the corpus refreshes automatically.</p>
            )}
            {addSource.isError && <p style={{ color: 'salmon' }}>{addSource.error.message}</p>}
            {(corpus.data?.sources.length ?? 0) > 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                {corpus.data!.sources.length} source(s) ·{' '}
                {corpus.data!.sources.filter((s) => s.hasContent).length} ingested
              </p>
            )}
          </section>

          <section>
            <h3>
              Corpus <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({phrases.length} phrases)</span>
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '0.75rem',
              }}
            >
              {byKind.map(({ kind, items }) => (
                <div key={kind} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <strong style={{ color: KIND_COLORS[kind] }}>
                    {kind} ({items.length})
                  </strong>
                  {items.map((p) => (
                    <div key={p.id} style={{ fontSize: 13 }} title={`source ${p.sourceRef ?? 'n/a'}`}>
                      “{p.phrase}”
                    </div>
                  ))}
                  {items.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 13 }}>none yet</span>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
