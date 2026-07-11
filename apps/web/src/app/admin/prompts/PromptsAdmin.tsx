'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.5rem',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
};
const btn = {
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
};

export function PromptsAdmin() {
  const utils = trpc.useUtils();
  const names = trpc.prompts.names.useQuery();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [diffPair, setDiffPair] = useState<{ aId: string; bId: string } | null>(null);

  const versions = trpc.prompts.versions.useQuery({ name }, { enabled: name.length > 0 });
  const diff = trpc.prompts.diff.useQuery(diffPair!, { enabled: !!diffPair });

  const create = trpc.prompts.create.useMutation({
    onSuccess: () => {
      setBody('');
      void utils.prompts.names.invalidate();
      void utils.prompts.versions.invalidate();
    },
  });
  const activate = trpc.prompts.activate.useMutation({
    onSuccess: () => void utils.prompts.versions.invalidate(),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section>
        <h2>Prompts</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {names.data?.map((n) => (
            <button key={n} onClick={() => setName(n)} style={{ ...box, cursor: 'pointer' }}>
              {n}
            </button>
          ))}
          {names.data?.length === 0 && <span style={{ color: 'var(--muted)' }}>No prompts yet.</span>}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 640 }}>
        <h3>Create / update a prompt version</h3>
        <input
          placeholder="prompt.name (e.g. council.schwartz)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={box}
        />
        <textarea
          placeholder="Prompt body…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          style={{ ...box, fontFamily: 'ui-monospace, monospace' }}
        />
        <div>
          <button
            onClick={() => create.mutate({ name, body })}
            disabled={create.isPending || !name || !body}
            style={btn}
          >
            {create.isPending ? 'Saving…' : 'Save new version (activate)'}
          </button>
        </div>
        {create.isError && <p style={{ color: 'salmon' }}>{create.error.message}</p>}
      </section>

      {name && (
        <section>
          <h3>Versions of {name}</h3>
          <ul>
            {versions.data?.map((v) => (
              <li key={v.id} style={{ marginBottom: '0.35rem' }}>
                v{v.version} {v.active && <span style={{ color: 'var(--ok)' }}>(active)</span>}{' '}
                {!v.active && (
                  <button onClick={() => activate.mutate({ id: v.id })} style={{ ...box, cursor: 'pointer' }}>
                    Activate
                  </button>
                )}
              </li>
            ))}
          </ul>
          {(versions.data?.length ?? 0) >= 2 && (
            <button
              onClick={() =>
                setDiffPair({ aId: versions.data![1]!.id, bId: versions.data![0]!.id })
              }
              style={{ ...box, cursor: 'pointer' }}
            >
              Diff latest two
            </button>
          )}
        </section>
      )}

      {diffPair && diff.data && (
        <section>
          <h3>
            Diff v{diff.data.a.version} → v{diff.data.b.version}
          </h3>
          <pre style={{ ...box, overflowX: 'auto' }}>
            {diff.data.ops.map((op, i) => (
              <div
                key={i}
                style={{
                  color:
                    op.type === 'add'
                      ? 'var(--ok)'
                      : op.type === 'remove'
                        ? 'salmon'
                        : 'var(--muted)',
                }}
              >
                {op.type === 'add' ? '+ ' : op.type === 'remove' ? '- ' : '  '}
                {op.text}
              </div>
            ))}
          </pre>
        </section>
      )}
    </div>
  );
}
