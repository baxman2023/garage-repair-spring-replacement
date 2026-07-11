'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hosted quiz runtime (WO-040): one question per screen, progress bar,
 * mobile-first. Talks to the same public API the single-file embed uses;
 * scoring never happens client-side.
 */

interface Question {
  id: string;
  text: string;
  options: Array<{ id: string; text: string }>;
}
interface LeadCapture {
  headline: string;
  button: string;
  fields: Array<'name' | 'email' | 'phone'>;
}
interface Completion {
  disqualified: boolean;
  band: { label: string; resultBlocks: Array<{ id: string; role: string; text: string }> } | null;
  decline: { headline: string; body: string } | null;
}

const card = {
  background: '#12151c',
  border: '1px solid #333',
  borderRadius: 12,
  padding: 24,
} as const;
const optionBtn = {
  display: 'block',
  width: '100%',
  textAlign: 'left' as const,
  padding: '14px 16px',
  margin: '8px 0',
  border: '1px solid #333',
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--fg)',
  fontSize: '1rem',
  cursor: 'pointer',
};
const primaryBtn = {
  display: 'block',
  width: '100%',
  padding: 14,
  marginTop: 12,
  border: 'none',
  borderRadius: 10,
  background: 'var(--accent)',
  color: '#04122e',
  fontSize: '1.05rem',
  fontWeight: 650,
  cursor: 'pointer',
} as const;

export function QuizRuntime({
  slug,
  questions,
  leadCapture,
}: {
  slug: string;
  questions: Question[];
  leadCapture: LeadCapture;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Completion | null>(null);
  const [error, setError] = useState('');
  const sessionRef = useRef<string | null>(null);

  const api = async (path: string, body: unknown) => {
    const res = await fetch(`/api/quiz/${encodeURIComponent(slug)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  };

  useEffect(() => {
    // Fire-and-forget session start; rendering never blocks on it.
    void api('/start', {}).then((s) => {
      sessionRef.current = (s as { sessionRef?: string }).sessionRef ?? null;
    }).catch(() => {});
  }, [slug]);

  const total = questions.length + 1;
  const progress = result ? 100 : Math.round((index / total) * 100);

  const answer = (questionId: string, optionId: string) => {
    setAnswers((a) => ({ ...a, [questionId]: optionId }));
    if (sessionRef.current) {
      void api('/answer', { sessionRef: sessionRef.current, questionId, optionId }).catch(() => {});
    }
    setIndex((i) => i + 1);
  };

  const complete = async () => {
    setError('');
    try {
      const ref =
        sessionRef.current ??
        ((await api('/start', {})) as { sessionRef: string }).sessionRef;
      sessionRef.current = ref;
      const completion = (await api('/complete', {
        sessionRef: ref,
        answers,
        contact,
      })) as unknown as Completion & { error?: string };
      if (completion.error) throw new Error(completion.error);
      setResult(completion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit — try again.');
    }
  };

  return (
    <div>
      <div style={{ height: 6, background: '#262a33', borderRadius: 3, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', transition: 'width .25s ease' }} />
      </div>

      {result ? (
        <div style={card}>
          {result.disqualified && result.decline ? (
            <>
              <h1 style={{ fontSize: '1.4rem', marginBottom: 12 }}>{result.decline.headline}</h1>
              <p style={{ lineHeight: 1.55 }}>{result.decline.body}</p>
            </>
          ) : (
            result.band?.resultBlocks.map((b) =>
              b.role === 'headline' ? (
                <h1 key={b.id} style={{ fontSize: '1.4rem', marginBottom: 12 }}>{b.text}</h1>
              ) : b.role === 'cta' ? (
                <button key={b.id} style={primaryBtn}>{b.text}</button>
              ) : (
                <p key={b.id} style={{ margin: '10px 0', lineHeight: 1.55 }}>{b.text}</p>
              ),
            )
          )}
        </div>
      ) : index < questions.length ? (
        <div style={card}>
          <div style={{ fontSize: '1.25rem', fontWeight: 650, marginBottom: 16, lineHeight: 1.35 }}>
            {questions[index]!.text}
          </div>
          {questions[index]!.options.map((o) => (
            <button key={o.id} style={optionBtn} onClick={() => answer(questions[index]!.id, o.id)}>
              {o.text}
            </button>
          ))}
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: '1.25rem', fontWeight: 650, marginBottom: 16 }}>{leadCapture.headline}</div>
          {leadCapture.fields.map((f) => (
            <input
              key={f}
              type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
              placeholder={f[0]!.toUpperCase() + f.slice(1)}
              value={contact[f] ?? ''}
              onChange={(e) => setContact((c) => ({ ...c, [f]: e.target.value }))}
              style={{ ...optionBtn, cursor: 'text' }}
            />
          ))}
          <button style={primaryBtn} onClick={() => void complete()}>
            {leadCapture.button}
          </button>
          {error && <p style={{ color: 'salmon', marginTop: 8 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
