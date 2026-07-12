'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

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
    <div className="stack-lg">
      <section>
        <h2>Prompts</h2>
        <div className="row">
          {names.data?.map((n) => (
            <button key={n} onClick={() => setName(n)} className="btn btn-sm">
              {n}
            </button>
          ))}
          {names.data?.length === 0 && <span className="muted">No prompts yet.</span>}
        </div>
      </section>

      <section className="stack-sm" style={{ maxWidth: 640 }}>
        <h3>Create / update a prompt version</h3>
        <input
          placeholder="prompt.name (e.g. council.schwartz)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
        />
        <textarea
          placeholder="Prompt body…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="textarea mono"
        />
        <div>
          <button
            onClick={() => create.mutate({ name, body })}
            disabled={create.isPending || !name || !body}
            className="btn btn-primary"
          >
            {create.isPending ? 'Saving…' : 'Save new version (activate)'}
          </button>
        </div>
        {create.isError && <p className="alert alert-danger">{create.error.message}</p>}
      </section>

      {name && (
        <section>
          <h3>Versions of {name}</h3>
          <ul>
            {versions.data?.map((v) => (
              <li key={v.id} style={{ marginBottom: '0.35rem' }}>
                v{v.version} {v.active && <span className="ok">(active)</span>}{' '}
                {!v.active && (
                  <button onClick={() => activate.mutate({ id: v.id })} className="btn btn-sm">
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
              className="btn btn-sm"
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
          <pre>
            {diff.data.ops.map((op, i) => (
              <div
                key={i}
                className={op.type === 'add' ? 'ok' : op.type === 'remove' ? 'danger' : 'muted'}
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
