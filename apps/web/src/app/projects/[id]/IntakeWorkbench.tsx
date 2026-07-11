'use client';

import { useRef, useState } from 'react';
import { trpc } from '@/trpc/react';
import type { ProductProfile } from '@copyforge/core';

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
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

export function IntakeWorkbench({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const profile = trpc.intake.profile.useQuery(
    { projectId },
    { refetchInterval: 4000 }, // dump jobs land asynchronously via the worker
  );

  // --- Dump mode ---
  const [dump, setDump] = useState('');
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const dumpText = trpc.intake.dumpText.useMutation({ onSuccess: () => setDump('') });
  const dumpUrl = trpc.intake.dumpUrl.useMutation({ onSuccess: () => setUrl('') });
  // Live extraction status (WO-056 UX fix): a failed worker job must surface,
  // not leave "queued" on screen forever.
  const dumpStatus = trpc.intake.dumpStatus.useQuery({ projectId }, { refetchInterval: 3000 });

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    dumpText.mutate({ projectId, text });
    if (fileRef.current) fileRef.current.value = '';
  }

  // --- Interrogation ---
  const [answered, setAnswered] = useState<string[]>([]);
  const questions = trpc.intake.questions.useQuery({ projectId, answered });
  const [answerText, setAnswerText] = useState('');
  const answer = trpc.intake.answer.useMutation({
    onSuccess: (_d, vars) => {
      setAnswered((a) => [...a, vars.field]);
      setAnswerText('');
      void utils.intake.profile.invalidate({ projectId });
      void utils.intake.questions.invalidate();
    },
  });
  const nextQuestion = questions.data?.[0];

  // --- Editor ---
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const save = trpc.intake.saveProfile.useMutation({
    onSuccess: () => {
      setEditing(false);
      void utils.intake.profile.invalidate({ projectId });
    },
  });

  const p: ProductProfile | undefined = profile.data?.profile;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <section>
        <h2>Dump mode</h2>
        <p style={{ color: 'var(--muted)' }}>
          Paste anything — sales pages, notes, transcripts — or give a URL / a .txt/.md file.
          The Sales Detective extracts the profile in the background.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 720 }}>
          <textarea
            rows={6}
            placeholder="Paste your dump here…"
            value={dump}
            onChange={(e) => setDump(e.target.value)}
            style={{ ...box, fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => dump.trim() && dumpText.mutate({ projectId, text: dump })}
              disabled={dumpText.isPending || !dump.trim()}
              style={btn}
            >
              {dumpText.isPending ? 'Queued…' : 'Extract from paste'}
            </button>
            <input
              placeholder="https://your-sales-page.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ ...box, minWidth: 280 }}
            />
            <button
              onClick={() => url.trim() && dumpUrl.mutate({ projectId, url })}
              disabled={dumpUrl.isPending || !url.trim()}
              style={btn}
            >
              {dumpUrl.isPending ? 'Queued…' : 'Extract from URL'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={(e) => void onFileChosen(e.target.files?.[0])}
              style={{ color: 'var(--muted)' }}
            />
          </div>
          {dumpStatus.data?.status === 'failed' ? (
            <p style={{ color: 'salmon' }}>
              Extraction failed: {dumpStatus.data.error ?? 'unknown error'}
              {/(401|invalid x-api-key|authentication)/i.test(dumpStatus.data.error ?? '') && (
                <>
                  {' '}— your Anthropic key looks invalid.{' '}
                  <a href="/settings/api-key">Update it in Settings</a>, then re-submit the dump.
                </>
              )}
            </p>
          ) : dumpStatus.data && dumpStatus.data.status !== 'done' ? (
            <p style={{ color: 'var(--ok)' }}>
              Extraction {dumpStatus.data.status === 'claimed' ? 'running' : 'queued'} — the
              profile below refreshes automatically when it lands.
            </p>
          ) : (
            (dumpText.isSuccess || dumpUrl.isSuccess) && (
              <p style={{ color: 'var(--ok)' }}>
                Dump queued — the profile below refreshes automatically when extraction lands.
              </p>
            )
          )}
          {(dumpText.isError || dumpUrl.isError) && (
            <p style={{ color: 'salmon' }}>{dumpText.error?.message ?? dumpUrl.error?.message}</p>
          )}
        </div>
      </section>

      <section>
        <h2>Interrogation</h2>
        {questions.isPending ? (
          <p style={{ color: 'var(--muted)' }}>Loading…</p>
        ) : nextQuestion ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (answerText.trim())
                answer.mutate({ projectId, field: nextQuestion.field, answer: answerText });
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 720 }}
          >
            <p>
              <strong>{nextQuestion.question}</strong>{' '}
              <span style={{ color: 'var(--muted)' }}>
                ({questions.data!.length} question{questions.data!.length === 1 ? '' : 's'} left)
              </span>
            </p>
            {nextQuestion.kind === 'choice' ? (
              <select value={answerText} onChange={(e) => setAnswerText(e.target.value)} style={box}>
                <option value="">choose…</option>
                {nextQuestion.choices?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                rows={nextQuestion.kind === 'list' ? 4 : 2}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder={nextQuestion.kind === 'list' ? 'One per line…' : 'Your answer…'}
                style={{ ...box, fontFamily: 'inherit' }}
              />
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={answer.isPending || !answerText.trim()} style={btn}>
                {answer.isPending ? 'Saving…' : 'Answer'}
              </button>
              <button
                type="button"
                onClick={() => setAnswered((a) => [...a, nextQuestion.field])}
                style={subtle}
              >
                Skip for now
              </button>
            </div>
            {answer.isError && <p style={{ color: 'salmon' }}>{answer.error.message}</p>}
          </form>
        ) : (
          <p style={{ color: 'var(--ok)' }}>All intake questions answered.</p>
        )}
      </section>

      <section>
        <h2>
          Product profile{' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
            v{profile.data?.version ?? 0}
          </span>
        </h2>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <textarea
              rows={20}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ ...box, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  try {
                    save.mutate({ projectId, profile: JSON.parse(draft) });
                  } catch {
                    alert('Not valid JSON.');
                  }
                }}
                disabled={save.isPending}
                style={btn}
              >
                {save.isPending ? 'Saving…' : 'Save as new version'}
              </button>
              <button onClick={() => setEditing(false)} style={subtle}>
                Cancel
              </button>
            </div>
            {save.isError && <p style={{ color: 'salmon' }}>{save.error.message}</p>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <pre style={{ ...box, overflowX: 'auto', fontSize: 13 }}>
              {p ? JSON.stringify(p, null, 2) : '…'}
            </pre>
            <div>
              <button
                onClick={() => {
                  setDraft(JSON.stringify(p, null, 2));
                  setEditing(true);
                }}
                style={subtle}
              >
                Edit profile
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
