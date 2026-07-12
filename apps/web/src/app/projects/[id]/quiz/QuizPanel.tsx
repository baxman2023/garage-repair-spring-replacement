'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/trpc/react';
import type { QuizQuestion } from '@copyforge/core';

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
    <div className="stack">
      <section className="row-lg">
        <button
          onClick={() => generate.mutate({ projectId })}
          disabled={generate.isPending}
          className="btn btn-primary"
        >
          {generate.isPending ? 'Queued…' : data ? 'Regenerate quiz' : 'Generate quiz'}
        </button>
        {data && questions && (
          <button
            onClick={() => update.mutate({ projectId, questions })}
            disabled={update.isPending}
            className="btn btn-primary"
          >
            Save edits
          </button>
        )}
        {data && (
          <span className="muted small">
            slug <code>{data.slug}</code>
          </span>
        )}
        {generate.isError && <span className="danger small">{generate.error.message}</span>}
        {update.isError && <span className="danger small">{update.error.message}</span>}
      </section>

      {data && (
        <section className="card">
          <strong>Routing simulation (1,000 synthetic respondents)</strong>{' '}
          <span className={data.simulation.pass ? 'badge badge-ok' : 'badge badge-danger'}>
            {data.simulation.pass ? 'PASS' : 'FAIL'}
          </span>
          <div className="row-lg small" style={{ marginTop: 8 }}>
            {Object.entries(data.simulation.perBucket).map(([bandId, b]) => {
              const band = data.bands.find((x) => x.id === bandId);
              return (
                <span key={bandId} className={b.hitRate >= 0.7 ? 'ok' : 'danger'}>
                  #{band?.market?.rank} {band?.market?.label}: {(b.hitRate * 100).toFixed(0)}%
                </span>
              );
            })}
            <span className="muted">
              disqualified tagged {data.simulation.disqualified.tagged}/{data.simulation.disqualified.intended}
            </span>
          </div>
        </section>
      )}

      {data &&
        questions?.map((q, qi) => (
          <section key={q.id} className="card stack-sm">
            <div>
              <span
                className="xsmall"
                style={{ color: q.kind === 'prequal' ? 'var(--warn)' : 'var(--accent)' }}
              >
                [{q.kind}]
              </span>{' '}
              <strong>{q.text}</strong>
            </div>
            {q.options.map((o, oi) => (
              <div key={o.id} className="row small">
                <span style={{ minWidth: 220 }}>
                  {o.text} {o.disqualify && <span className="danger">(disqualifies)</span>}
                </span>
                {q.kind === 'routing' &&
                  data.bands.map((band) => (
                    <label key={band.marketId}>
                      #{band.market?.rank}
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={o.weights[band.marketId] ?? 0}
                        onChange={(e) => setWeight(qi, oi, band.marketId, Number(e.target.value))}
                        className="input"
                        style={{ width: 52, marginLeft: 4 }}
                      />
                    </label>
                  ))}
              </div>
            ))}
          </section>
        ))}

      {data && (
        <section className="card small">
          <strong>Bands</strong>
          {data.bands.map((b) => (
            <div key={b.id} style={{ marginTop: 6 }}>
              <span style={{ color: 'var(--accent)' }}>
                #{b.market?.rank} {b.label}
              </span>{' '}
              <span className="muted">
                → {b.resultBlocks.length} result blocks (short-form letter + CTA)
              </span>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 6 }}>
            Decline page: “{data.scoring.decline.headline}”
          </div>
        </section>
      )}

      {!data && !quiz.isLoading && (
        <p className="muted">No quiz yet — generate one from the five diagnosed markets.</p>
      )}
    </div>
  );
}
