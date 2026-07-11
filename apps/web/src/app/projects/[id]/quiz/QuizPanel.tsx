'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/trpc/react';
import type { QuizQuestion } from '@copyforge/core';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;
const btn = {
  padding: '0.45rem 0.85rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;
const input = { ...subtle, cursor: 'text' } as const;

export function QuizPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const quiz = trpc.quiz.get.useQuery({ projectId }, { refetchInterval: 5000 });
  const generate = trpc.quiz.generate.useMutation({
    onSuccess: () => void utils.quiz.get.invalidate({ projectId }),
  });
  const update = trpc.quiz.update.useMutation({
    onSuccess: () => void utils.quiz.get.invalidate({ projectId }),
  });

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  useEffect(() => {
    if (quiz.data && questions === null) setQuestions(quiz.data.questions);
  }, [quiz.data, questions]);

  const data = quiz.data;

  const setWeight = (qi: number, oi: number, marketId: string, value: number) => {
    setQuestions((qs) => {
      if (!qs) return qs;
      const next = structuredClone(qs);
      const weights = next[qi]!.options[oi]!.weights;
      if (value === 0) delete weights[marketId];
      else weights[marketId] = value;
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => generate.mutate({ projectId })} disabled={generate.isPending} style={btn}>
          {generate.isPending ? 'Queued…' : data ? 'Regenerate quiz' : 'Generate quiz'}
        </button>
        {data && questions && (
          <button
            onClick={() => update.mutate({ projectId, questions })}
            disabled={update.isPending}
            style={btn}
          >
            Save edits
          </button>
        )}
        {data && (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            slug <code>{data.slug}</code>
          </span>
        )}
        {generate.isError && <span style={{ color: 'salmon' }}>{generate.error.message}</span>}
        {update.isError && <span style={{ color: 'salmon' }}>{update.error.message}</span>}
      </section>

      {data && (
        <section style={{ ...box }}>
          <strong>Routing simulation (1,000 synthetic respondents)</strong>{' '}
          <span style={{ color: data.simulation.pass ? 'var(--ok)' : 'salmon', fontWeight: 600 }}>
            {data.simulation.pass ? 'PASS' : 'FAIL'}
          </span>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
            {Object.entries(data.simulation.perBucket).map(([bandId, b]) => {
              const band = data.bands.find((x) => x.id === bandId);
              return (
                <span key={bandId} style={{ color: b.hitRate >= 0.7 ? 'var(--ok)' : 'salmon' }}>
                  #{band?.market?.rank} {band?.market?.label}: {(b.hitRate * 100).toFixed(0)}%
                </span>
              );
            })}
            <span style={{ color: 'var(--muted)' }}>
              disqualified tagged {data.simulation.disqualified.tagged}/{data.simulation.disqualified.intended}
            </span>
          </div>
        </section>
      )}

      {data &&
        questions?.map((q, qi) => (
          <section key={q.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <span style={{ color: q.kind === 'prequal' ? '#f0c674' : 'var(--accent)', fontSize: 12 }}>
                [{q.kind}]
              </span>{' '}
              <strong>{q.text}</strong>
            </div>
            {q.options.map((o, oi) => (
              <div key={o.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ minWidth: 220 }}>
                  {o.text} {o.disqualify && <span style={{ color: 'salmon' }}>(disqualifies)</span>}
                </span>
                {q.kind === 'routing' &&
                  data.bands.map((band) => (
                    <label key={band.marketId} style={{ color: 'var(--muted)' }}>
                      #{band.market?.rank}
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={o.weights[band.marketId] ?? 0}
                        onChange={(e) => setWeight(qi, oi, band.marketId, Number(e.target.value))}
                        style={{ ...input, width: 52, marginLeft: 4 }}
                      />
                    </label>
                  ))}
              </div>
            ))}
          </section>
        ))}

      {data && (
        <section style={{ ...box, fontSize: 13 }}>
          <strong>Bands</strong>
          {data.bands.map((b) => (
            <div key={b.id} style={{ marginTop: 6 }}>
              <span style={{ color: 'var(--accent)' }}>
                #{b.market?.rank} {b.label}
              </span>{' '}
              <span style={{ color: 'var(--muted)' }}>
                → {b.resultBlocks.length} result blocks (short-form letter + CTA)
              </span>
            </div>
          ))}
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>
            Decline page: “{data.scoring.decline.headline}”
          </div>
        </section>
      )}

      {!data && !quiz.isLoading && (
        <p style={{ color: 'var(--muted)' }}>No quiz yet — generate one from the five diagnosed markets.</p>
      )}
    </div>
  );
}
