'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const TYPES = ['lead', 'mechanism_name', 'proof_stack', 'price_reveal', 'close', 'bullet_style', 'headline_pattern'] as const;

export function GenomePanel() {
  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');
  const [niche, setNiche] = useState('');
  const [filterType, setFilterType] = useState<(typeof TYPES)[number] | ''>('');
  const [filterNiche, setFilterNiche] = useState('');

  const addSwipe = trpc.genome.addSwipe.useMutation({
    onSuccess: () => {
      setPaste('');
      setUrl('');
    },
  });
  const swipes = trpc.genome.swipes.useQuery({}, { refetchInterval: 5000 });
  const components = trpc.genome.components.useQuery(
    {
      ...(filterType ? { type: filterType } : {}),
      ...(filterNiche.trim() ? { niche: filterNiche.trim() } : {}),
      limit: 60,
    },
    { refetchInterval: 5000 },
  );

  return (
    <div className="stack-lg">
      <section className="stack-sm" style={{ maxWidth: 760 }}>
        <h2 style={{ margin: 0 }}>Add swipes</h2>
        <textarea
          rows={5}
          placeholder="Paste a winning ad / sales page / email…"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          className="textarea"
        />
        <div className="row">
          <input placeholder="niche (optional)" value={niche} onChange={(e) => setNiche(e.target.value)} className="input" />
          <button
            onClick={() => addSwipe.mutate({ kind: 'paste', content: paste, niche: niche || undefined })}
            disabled={addSwipe.isPending || !paste.trim()}
            className="btn btn-primary"
          >
            Decompose paste
          </button>
          <input placeholder="https://swipe-url…" value={url} onChange={(e) => setUrl(e.target.value)} className="input" style={{ minWidth: 260 }} />
          <button
            onClick={() => addSwipe.mutate({ kind: 'url', url, niche: niche || undefined })}
            disabled={addSwipe.isPending || !url.trim()}
            className="btn btn-primary"
          >
            Decompose URL
          </button>
        </div>
        {addSwipe.isSuccess && <p className="alert alert-ok">Queued — components appear below shortly.</p>}
        {addSwipe.isError && <p className="alert alert-danger">{addSwipe.error.message}</p>}
        <p className="muted small">
          {swipes.data?.length ?? 0} swipe(s) in your library (shared seed + private).
        </p>
      </section>

      <HarvesterSection />

      <section className="stack-sm">
        <h2 style={{ margin: 0 }}>Components</h2>
        <div className="row">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as never)} className="select">
            <option value="">all types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            placeholder="filter niche…"
            value={filterNiche}
            onChange={(e) => setFilterNiche(e.target.value)}
            className="input"
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.6rem' }}>
          {components.data?.map((c) => {
            const content = c.content as { summary?: string; evidence?: string; pattern?: string };
            return (
              <div key={c.id} className="card stack-sm">
                <div className="spread">
                  <strong style={{ color: 'var(--accent)' }}>{c.type}</strong>
                  <span className="muted xsmall">
                    {c.niche ?? '—'} · conf {c.confidence?.toFixed(2) ?? '?'} {c.shared ? '· seed' : ''}
                  </span>
                </div>
                {content.pattern && <em className="small">{content.pattern}</em>}
                <div className="small">{content.summary}</div>
                <div className="muted xsmall">“{content.evidence}”</div>
              </div>
            );
          })}
          {components.data?.length === 0 && (
            <p className="muted">No components yet — decompose a swipe.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function HarvesterSection() {
  const utils = trpc.useUtils();
  const queries = trpc.genome.harvestQueries.useQuery(undefined, { refetchInterval: 6000 });
  const [niche, setNiche] = useState('');
  const [terms, setTerms] = useState('');
  const save = trpc.genome.saveHarvestQuery.useMutation({
    onSuccess: () => {
      setNiche('');
      setTerms('');
      void utils.genome.harvestQueries.invalidate();
    },
  });
  const run = trpc.genome.runHarvest.useMutation({
    onSuccess: () => void utils.genome.harvestQueries.invalidate(),
  });

  return (
    <section className="stack-sm" style={{ maxWidth: 860 }}>
      <h2 style={{ margin: 0 }}>Ad Library harvester</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Saved per-niche queries pull long-running (≥90 day) ads into the genome. If the API is
        unavailable the run degrades to guided manual paste — same pipeline either way.
      </p>
      <div className="row">
        <input placeholder="niche" value={niche} onChange={(e) => setNiche(e.target.value)} className="input" />
        <input
          placeholder="search terms (e.g. garage door repair)"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          className="input"
          style={{ minWidth: 280 }}
        />
        <button
          onClick={() => save.mutate({ niche, terms, country: 'US' })}
          disabled={save.isPending || !niche.trim() || !terms.trim()}
          className="btn btn-primary"
        >
          Save query
        </button>
      </div>
      {queries.data?.map((q) => {
        const result = q.lastResult as { status?: string; stored?: number; guidance?: string } | null;
        return (
          <div key={q.id} className="card stack-sm">
            <div className="spread">
              <strong>
                {q.niche} — “{String((q.query as { terms?: string }).terms ?? '')}”
              </strong>
              <button onClick={() => run.mutate({ queryId: q.id })} disabled={run.isPending} className="btn btn-primary">
                Harvest now
              </button>
            </div>
            {result?.status === 'ok' && (
              <span className="ok small">
                Last run stored {result.stored} long-running ad(s).
              </span>
            )}
            {result?.status === 'degraded' && (
              <span className="warn small">⚠ {result.guidance}</span>
            )}
            {!result && <span className="muted small">never run</span>}
          </div>
        );
      })}
      {run.isError && <p className="alert alert-danger">{run.error.message}</p>}
    </section>
  );
}
