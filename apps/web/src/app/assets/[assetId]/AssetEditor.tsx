'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/trpc/react';
import type { AssetBlock } from '@copyforge/core';

const box = {
  padding: '0.6rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;
const btn = {
  padding: '0.45rem 0.8rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

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

  if (asset.isPending) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  if (asset.isError) return <p style={{ color: 'salmon' }}>{asset.error.message}</p>;
  const data = asset.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ margin: 0 }}>
        <strong>{data.type}</strong> — status <code>{data.status}</code> — v
        {data.current?.version ?? 0} ·{' '}
        <Link href={`/assets/${assetId}/council`}>Council report →</Link>
      </p>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {blocks.map((b, i) => (
          <div key={b.id} style={{ ...box, display: 'flex', gap: '0.6rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 90 }}>
              <strong style={{ fontSize: 12, color: 'var(--accent)' }}>{b.role}</strong>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{b.id}</span>
              <button
                onClick={() =>
                  mutate((bs) =>
                    bs.map((x) =>
                      x.id === b.id ? { ...x, meta: { ...x.meta, locked: !x.meta?.locked } } : x,
                    ),
                  )
                }
                style={{ ...subtle, padding: '0.2rem 0.4rem', fontSize: 12 }}
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
                style={{ ...subtle, padding: '0.2rem 0.4rem', fontSize: 12, opacity: i === 0 ? 0.4 : 1 }}
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
                style={{ ...subtle, padding: '0.2rem 0.4rem', fontSize: 12, opacity: i === blocks.length - 1 ? 0.4 : 1 }}
              >
                ↓
              </button>
              <button
                disabled={Boolean(b.meta?.locked) || regen.isPending}
                onClick={() => regen.mutate({ assetId, blockId: b.id })}
                title={b.meta?.locked ? 'Locked blocks cannot regenerate' : 'Regenerate this block'}
                style={{ ...subtle, padding: '0.2rem 0.4rem', fontSize: 12, opacity: b.meta?.locked ? 0.4 : 1 }}
              >
                ♻ regen
              </button>
            </div>
            <textarea
              rows={Math.min(10, Math.max(2, b.text.split('\n').length + 1))}
              value={b.text}
              disabled={Boolean(b.meta?.locked)}
              onChange={(e) => mutate((bs) => bs.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))}
              style={{ ...box, flex: 1, fontFamily: 'inherit', opacity: b.meta?.locked ? 0.65 : 1 }}
            />
          </div>
        ))}
        {blocks.length === 0 && <p style={{ color: 'var(--muted)' }}>No version yet.</p>}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={() => save.mutate({ assetId, blocks })}
            disabled={save.isPending || !dirty}
            style={{ ...btn, opacity: dirty ? 1 : 0.5 }}
          >
            {save.isPending ? 'Saving…' : 'Save as new version'}
          </button>
          {regen.isSuccess && <span style={{ color: 'var(--muted)' }}>Regeneration queued…</span>}
          {regen.isError && <span style={{ color: 'salmon' }}>{regen.error.message}</span>}
          {save.isError && <span style={{ color: 'salmon' }}>{save.error.message}</span>}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Versions & diff</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} style={box}>
            <option value="">from…</option>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.createdBy})
              </option>
            ))}
          </select>
          <select value={diffTo} onChange={(e) => setDiffTo(e.target.value)} style={box}>
            <option value="">to…</option>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.createdBy})
              </option>
            ))}
          </select>
        </div>
        {diff.data && (
          <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <strong>
              v{diff.data.from} → v{diff.data.to}
              {diff.data.diff.reordered && <span style={{ color: '#f0c674' }}> · reordered</span>}
            </strong>
            {diff.data.diff.added.map((b) => (
              <div key={b.id} style={{ color: 'var(--ok)', fontSize: 13 }}>
                + [{b.id}] {b.text.slice(0, 120)}
              </div>
            ))}
            {diff.data.diff.removed.map((b) => (
              <div key={b.id} style={{ color: 'salmon', fontSize: 13 }}>
                − [{b.id}] {b.text.slice(0, 120)}
              </div>
            ))}
            {diff.data.diff.changed.map((c) => (
              <div key={c.id} style={{ fontSize: 13 }}>
                <strong>~ [{c.id}]</strong>
                <pre style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>
                  {c.ops.map((op, i) => (
                    <div
                      key={i}
                      style={{
                        color: op.type === 'add' ? 'var(--ok)' : op.type === 'remove' ? 'salmon' : 'var(--muted)',
                      }}
                    >
                      {op.type === 'add' ? '+ ' : op.type === 'remove' ? '− ' : '  '}
                      {op.text}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
            {diff.data.diff.added.length + diff.data.diff.removed.length + diff.data.diff.changed.length === 0 && (
              <span style={{ color: 'var(--muted)' }}>No changes.</span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
