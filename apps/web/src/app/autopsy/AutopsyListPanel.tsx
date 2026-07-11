'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AUTOPSY_PAGE_KINDS, type AutopsyPageKind } from '@copyforge/core';
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
const input = {
  width: '100%',
  padding: '0.4rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#0b0e14',
  color: 'inherit',
  fontSize: 13,
} as const;

const KIND_LABEL: Record<AutopsyPageKind, string> = {
  ad: 'Ad (traffic creative)',
  landing: 'Landing page',
  vsl_transcript: 'VSL transcript',
  checkout: 'Checkout page',
};

type Draft = { url: string; content: string };

export function AutopsyListPanel() {
  const utils = trpc.useUtils();
  const list = trpc.autopsy.list.useQuery(undefined, { refetchInterval: 5000 });
  const create = trpc.autopsy.create.useMutation({
    onSuccess: () => void utils.autopsy.list.invalidate(),
  });

  const [title, setTitle] = useState('');
  const [drafts, setDrafts] = useState<Record<AutopsyPageKind, Draft>>(
    Object.fromEntries(AUTOPSY_PAGE_KINDS.map((k) => [k, { url: '', content: '' }])) as Record<
      AutopsyPageKind,
      Draft
    >,
  );

  const setDraft = (kind: AutopsyPageKind, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [kind]: { ...d[kind], ...patch } }));

  const pages = AUTOPSY_PAGE_KINDS.filter((k) => drafts[k].url.trim() || drafts[k].content.trim()).map(
    (k) => ({
      kind: k,
      sourceUrl: drafts[k].url.trim() || undefined,
      content: drafts[k].content.trim() || undefined,
    }),
  );
  const canSubmit = title.trim().length > 0 && pages.length > 0 && !create.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section style={box}>
        <h2 style={{ margin: '0 0 0.6rem', fontSize: 16 }}>New autopsy</h2>
        <input
          style={{ ...input, marginBottom: '0.6rem' }}
          placeholder="Title (whose funnel is this?)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          {AUTOPSY_PAGE_KINDS.map((kind) => (
            <div key={kind}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{KIND_LABEL[kind]}</div>
              <input
                style={{ ...input, marginBottom: 4 }}
                placeholder="URL to auto-fetch (optional)"
                value={drafts[kind].url}
                onChange={(e) => setDraft(kind, { url: e.target.value })}
              />
              <textarea
                style={{ ...input, minHeight: 70, resize: 'vertical' }}
                placeholder="…or paste the content"
                value={drafts[kind].content}
                onChange={(e) => setDraft(kind, { content: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button
            style={{ ...btn, opacity: canSubmit ? 1 : 0.5 }}
            disabled={!canSubmit}
            onClick={() => create.mutate({ title: title.trim(), pages })}
          >
            Run autopsy
          </button>
          {create.error && <span style={{ color: 'salmon', fontSize: 12 }}>{create.error.message}</span>}
        </div>
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: 16 }}>Teardowns</h2>
        {(list.data ?? []).map((a) => (
          <div key={a.id} style={{ ...box, marginBottom: '0.5rem', fontSize: 14 }}>
            <Link href={`/autopsy/${a.id}`} style={{ fontWeight: 600 }}>
              {a.title}
            </Link>{' '}
            <span style={{ color: a.status === 'complete' ? 'var(--ok)' : a.status === 'failed' ? 'salmon' : 'var(--muted)' }}>
              {a.status}
            </span>
            {a.shareToken && <span style={{ color: 'var(--muted)', fontSize: 12 }}> · shared</span>}
            {a.error && <div style={{ color: 'salmon', fontSize: 12 }}>{a.error}</div>}
          </div>
        ))}
        {list.data && list.data.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No teardowns yet.</p>
        )}
      </section>
    </div>
  );
}
