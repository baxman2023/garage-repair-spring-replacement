'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AUTOPSY_PAGE_KINDS, type AutopsyPageKind } from '@copyforge/core';
import { trpc } from '@/trpc/react';

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
    <div className="stack">
      <section className="card">
        <h2>New autopsy</h2>
        <input
          className="input"
          style={{ width: '100%', marginBottom: '0.6rem' }}
          placeholder="Title (whose funnel is this?)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          {AUTOPSY_PAGE_KINDS.map((kind) => (
            <div key={kind}>
              <div className="muted xsmall" style={{ marginBottom: 4 }}>{KIND_LABEL[kind]}</div>
              <input
                className="input"
                style={{ width: '100%', marginBottom: 4 }}
                placeholder="URL to auto-fetch (optional)"
                value={drafts[kind].url}
                onChange={(e) => setDraft(kind, { url: e.target.value })}
              />
              <textarea
                className="textarea"
                style={{ width: '100%', minHeight: 70 }}
                placeholder="…or paste the content"
                value={drafts[kind].content}
                onChange={(e) => setDraft(kind, { content: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={!canSubmit}
            onClick={() => create.mutate({ title: title.trim(), pages })}
          >
            Run autopsy
          </button>
          {create.error && <span className="danger xsmall">{create.error.message}</span>}
        </div>
      </section>

      <section>
        <h2>Teardowns</h2>
        {(list.data ?? []).map((a) => (
          <div key={a.id} className="card" style={{ marginBottom: '0.5rem' }}>
            <Link href={`/autopsy/${a.id}`} style={{ fontWeight: 600 }}>
              {a.title}
            </Link>{' '}
            <span
              className={
                a.status === 'complete'
                  ? 'badge badge-ok'
                  : a.status === 'failed'
                    ? 'badge badge-danger'
                    : 'badge badge-warn'
              }
            >
              {a.status}
            </span>
            {a.shareToken && <span className="muted xsmall"> · shared</span>}
            {a.error && <div className="danger xsmall">{a.error}</div>}
          </div>
        ))}
        {list.data && list.data.length === 0 && (
          <p className="muted">No teardowns yet.</p>
        )}
      </section>
    </div>
  );
}
