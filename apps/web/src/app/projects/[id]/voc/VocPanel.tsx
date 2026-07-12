'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const KIND_COLORS: Record<string, string> = {
  pain: 'var(--danger)',
  desire: 'var(--ok)',
  objection: 'var(--warn)',
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
    <div className="stack">
      <section className="row">
        {markets.data?.map((m) => (
          <button
            key={m.id}
            onClick={() => setMarketId(m.id)}
            className="btn"
            style={m.id === activeMarket ? { borderColor: 'var(--accent)' } : undefined}
          >
            #{m.rank} {m.label}
          </button>
        ))}
        {markets.data?.length === 0 && (
          <p className="muted">Select markets first (Market Selection).</p>
        )}
      </section>

      {activeMarket && (
        <>
          <section className="stack-sm" style={{ maxWidth: 720 }}>
            <h3 style={{ margin: 0 }}>Add sources</h3>
            <textarea
              rows={5}
              placeholder="Paste reviews, threads, comments…"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="textarea"
            />
            <div className="row">
              <button
                onClick={() =>
                  addSource.mutate({ projectId, marketId: activeMarket, kind: 'paste', content: paste })
                }
                disabled={addSource.isPending || !paste.trim()}
                className="btn btn-primary"
              >
                Mine paste
              </button>
              <input
                placeholder="https://reviews-page…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="input"
                style={{ minWidth: 280 }}
              />
              <button
                onClick={() => addSource.mutate({ projectId, marketId: activeMarket, kind: 'url', url })}
                disabled={addSource.isPending || !url.trim()}
                className="btn btn-primary"
              >
                Mine URL
              </button>
            </div>
            {addSource.isSuccess && (
              <p className="alert alert-ok">Mining queued — the corpus refreshes automatically.</p>
            )}
            {addSource.isError && <p className="alert alert-danger">{addSource.error.message}</p>}
            {(corpus.data?.sources.length ?? 0) > 0 && (
              <p className="muted small">
                {corpus.data!.sources.length} source(s) ·{' '}
                {corpus.data!.sources.filter((s) => s.hasContent).length} ingested
              </p>
            )}
          </section>

          <section>
            <h3>
              Corpus <span className="muted" style={{ fontWeight: 400 }}>({phrases.length} phrases)</span>
            </h3>
            <div className="grid-2">
              {byKind.map(({ kind, items }) => (
                <div key={kind} className="card stack-sm">
                  <strong style={{ color: KIND_COLORS[kind] }}>
                    {kind} ({items.length})
                  </strong>
                  {items.map((p) => (
                    <div key={p.id} className="small" title={`source ${p.sourceRef ?? 'n/a'}`}>
                      “{p.phrase}”
                    </div>
                  ))}
                  {items.length === 0 && <span className="muted small">none yet</span>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
