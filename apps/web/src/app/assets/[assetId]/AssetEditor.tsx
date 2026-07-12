'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/trpc/react';
import type { AssetBlock } from '@copyforge/core';

export function AssetEditor({ assetId }: { assetId: string }) {
  const utils = trpc.useUtils();
  const asset = trpc.assets.get.useQuery({ assetId }, { refetchInterval: 5000 });
  const save = trpc.assets.saveBlocks.useMutation({
    onSuccess: () => {
      setDirty(false);
      void utils.assets.get.invalidate({ assetId });
    },
  });
  const regen = trpc.assets.regenerateBlock.useMutation();

  const [blocks, setBlocks] = useState<AssetBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const [diffFrom, setDiffFrom] = useState<string>('');
  const [diffTo, setDiffTo] = useState<string>('');

  useEffect(() => {
    if (asset.data?.current && !dirty) setBlocks(asset.data.current.blocks);
  }, [asset.data, dirty]);

  const diff = trpc.assets.diff.useQuery(
    { assetId, fromVersionId: diffFrom, toVersionId: diffTo },
    { enabled: diffFrom.length === 26 && diffTo.length === 26 },
  );

  function mutate(fn: (blocks: AssetBlock[]) => AssetBlock[]) {
    setBlocks((prev) => fn(prev));
    setDirty(true);
  }

  if (asset.isPending) return <p className="muted">Loading…</p>;
  if (asset.isError) return <p className="alert alert-danger">{asset.error.message}</p>;
  const data = asset.data;

  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <strong>{data.type}</strong> — status <code>{data.status}</code> — v
        {data.current?.version ?? 0} ·{' '}
        <Link href={`/assets/${assetId}/council`}>Council report →</Link>
      </p>

      <section className="stack-sm">
        {blocks.map((b, i) => (
          <div key={b.id} className="card" style={{ display: 'flex', gap: '0.6rem' }}>
            <div className="stack-sm" style={{ gap: '0.25rem', minWidth: 90 }}>
              <strong className="xsmall" style={{ color: 'var(--accent)' }}>{b.role}</strong>
              <span className="muted" style={{ fontSize: 11 }}>{b.id}</span>
              <button
                onClick={() =>
                  mutate((bs) =>
                    bs.map((x) =>
                      x.id === b.id ? { ...x, meta: { ...x.meta, locked: !x.meta?.locked } } : x,
                    ),
                  )
                }
                className="btn btn-sm"
              >
                {b.meta?.locked ? '🔒 locked' : '🔓 unlocked'}
              </button>
              <button
                disabled={i === 0}
                onClick={() =>
                  mutate((bs) => {
                    const next = [...bs];
                    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                    return next;
                  })
                }
                className="btn btn-sm"
              >
                ↑
              </button>
              <button
                disabled={i === blocks.length - 1}
                onClick={() =>
                  mutate((bs) => {
                    const next = [...bs];
                    [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
                    return next;
                  })
                }
                className="btn btn-sm"
              >
                ↓
              </button>
              <button
                disabled={Boolean(b.meta?.locked) || regen.isPending}
                onClick={() => regen.mutate({ assetId, blockId: b.id })}
                title={b.meta?.locked ? 'Locked blocks cannot regenerate' : 'Regenerate this block'}
                className="btn btn-sm"
              >
                ♻ regen
              </button>
            </div>
            <textarea
              rows={Math.min(10, Math.max(2, b.text.split('\n').length + 1))}
              value={b.text}
              disabled={Boolean(b.meta?.locked)}
              onChange={(e) => mutate((bs) => bs.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))}
              className="textarea"
              style={{ flex: 1, opacity: b.meta?.locked ? 0.65 : 1 }}
            />
          </div>
        ))}
        {blocks.length === 0 && <p className="muted">No version yet.</p>}
        <div className="row">
          <button
            onClick={() => save.mutate({ assetId, blocks })}
            disabled={save.isPending || !dirty}
            className="btn btn-primary"
          >
            {save.isPending ? 'Saving…' : 'Save as new version'}
          </button>
          {regen.isSuccess && <span className="muted">Regeneration queued…</span>}
          {regen.isError && <span className="danger small">{regen.error.message}</span>}
          {save.isError && <span className="danger small">{save.error.message}</span>}
        </div>
      </section>

      <section className="stack-sm">
        <h3 style={{ margin: 0 }}>Versions & diff</h3>
        <div className="row">
          <select value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} className="select">
            <option value="">from…</option>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.createdBy})
              </option>
            ))}
          </select>
          <select value={diffTo} onChange={(e) => setDiffTo(e.target.value)} className="select">
            <option value="">to…</option>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.createdBy})
              </option>
            ))}
          </select>
        </div>
        {diff.data && (
          <div className="card stack-sm">
            <strong>
              v{diff.data.from} → v{diff.data.to}
              {diff.data.diff.reordered && <span className="warn"> · reordered</span>}
            </strong>
            {diff.data.diff.added.map((b) => (
              <div key={b.id} className="ok small">
                + [{b.id}] {b.text.slice(0, 120)}
              </div>
            ))}
            {diff.data.diff.removed.map((b) => (
              <div key={b.id} className="danger small">
                − [{b.id}] {b.text.slice(0, 120)}
              </div>
            ))}
            {diff.data.diff.changed.map((c) => (
              <div key={c.id} className="small">
                <strong>~ [{c.id}]</strong>
                <pre style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                  {c.ops.map((op, i) => (
                    <div
                      key={i}
                      className={op.type === 'add' ? 'ok' : op.type === 'remove' ? 'danger' : 'muted'}
                    >
                      {op.type === 'add' ? '+ ' : op.type === 'remove' ? '− ' : '  '}
                      {op.text}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
            {diff.data.diff.added.length + diff.data.diff.removed.length + diff.data.diff.changed.length === 0 && (
              <span className="muted">No changes.</span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
