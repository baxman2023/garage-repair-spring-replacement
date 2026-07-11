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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 760 }}>
        <h2 style={{ margin: 0 }}>Add swipes</h2>
        <textarea
          rows={5}
          placeholder="Paste a winning ad / sales page / email…"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          style={{ ...box, fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input placeholder="niche (optional)" value={niche} onChange={(e) => setNiche(e.target.value)} style={box} />
          <button
            onClick={() => addSwipe.mutate({ kind: 'paste', content: paste, niche: niche || undefined })}
            disabled={addSwipe.isPending || !paste.trim()}
            style={btn}
          >
            Decompose paste
          </button>
          <input placeholder="https://swipe-url…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ ...box, minWidth: 260 }} />
          <button
            onClick={() => addSwipe.mutate({ kind: 'url', url, niche: niche || undefined })}
            disabled={addSwipe.isPending || !url.trim()}
            style={btn}
          >
            Decompose URL
          </button>
        </div>
        {addSwipe.isSuccess && <p style={{ color: 'var(--ok)' }}>Queued — components appear below shortly.</p>}
        {addSwipe.isError && <p style={{ color: 'salmon' }}>{addSwipe.error.message}</p>}
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          {swipes.data?.length ?? 0} swipe(s) in your library (shared seed + private).
        </p>
      </section>

      <HarvesterSection />

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <h2 style={{ margin: 0 }}>Components</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as never)} style={box}>
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
            style={box}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.6rem' }}>
          {components.data?.map((c) => {
            const content = c.content as { summary?: string; evidence?: string; pattern?: string };
            return (
              <div key={c.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ color: 'var(--accent)' }}>{c.type}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {c.niche ?? '—'} · conf {c.confidence?.toFixed(2) ?? '?'} {c.shared ? '· seed' : ''}
                  </span>
                </div>
                {content.pattern && <em style={{ fontSize: 13 }}>{content.pattern}</em>}
                <div style={{ fontSize: 13 }}>{content.summary}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>“{content.evidence}”</div>
              </div>
            );
          })}
          {components.data?.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>No components yet — decompose a swipe.</p>
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 860 }}>
      <h2 style={{ margin: 0 }}>Ad Library harvester</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
        Saved per-niche queries pull long-running (≥90 day) ads into the genome. If the API is
        unavailable the run degrades to guided manual paste — same pipeline either way.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input placeholder="niche" value={niche} onChange={(e) => setNiche(e.target.value)} style={box} />
        <input
          placeholder="search terms (e.g. garage door repair)"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          style={{ ...box, minWidth: 280 }}
        />
        <button
          onClick={() => save.mutate({ niche, terms, country: 'US' })}
          disabled={save.isPending || !niche.trim() || !terms.trim()}
          style={btn}
        >
          Save query
        </button>
      </div>
      {queries.data?.map((q) => {
        const result = q.lastResult as { status?: string; stored?: number; guidance?: string } | null;
        return (
          <div key={q.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong>
                {q.niche} — “{String((q.query as { terms?: string }).terms ?? '')}”
              </strong>
              <button onClick={() => run.mutate({ queryId: q.id })} disabled={run.isPending} style={btn}>
                Harvest now
              </button>
            </div>
            {result?.status === 'ok' && (
              <span style={{ color: 'var(--ok)', fontSize: 13 }}>
                Last run stored {result.stored} long-running ad(s).
              </span>
            )}
            {result?.status === 'degraded' && (
              <span style={{ color: '#f0c674', fontSize: 13 }}>⚠ {result.guidance}</span>
            )}
            {!result && <span style={{ color: 'var(--muted)', fontSize: 13 }}>never run</span>}
          </div>
        );
      })}
      {run.isError && <p style={{ color: 'salmon' }}>{run.error.message}</p>}
    </section>
  );
}
