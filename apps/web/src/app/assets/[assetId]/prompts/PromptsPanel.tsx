'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

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

function PromptCard({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        {text ? (
          <button onClick={() => void copy()} style={btn}>
            {copied ? 'Copied ✓' : 'Copy to clipboard'}
          </button>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>not compiled yet</span>
        )}
      </div>
      {text && (
        <>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{text.length.toLocaleString()} chars</span>
          <pre
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              maxHeight: 320,
              overflowY: 'auto',
              margin: 0,
            }}
          >
            {text}
          </pre>
        </>
      )}
    </section>
  );
}

export function PromptsPanel({ assetId }: { assetId: string }) {
  const utils = trpc.useUtils();
  const latest = trpc.packages.latest.useQuery({ assetId }, { refetchInterval: 5000 });
  const compileUniversal = trpc.packages.compileUniversal.useMutation({
    onSuccess: () => void utils.packages.latest.invalidate({ assetId }),
  });
  const pkg = latest.data?.package;

  if (!pkg) {
    return latest.isLoading ? null : (
      <p style={{ color: 'var(--muted)' }}>No package composed yet — the G7 composer runs after compliance.</p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: pkg.g7.pass ? 'var(--ok)' : '#f0c674', fontWeight: 600 }}>
          {pkg.g7.pass ? '● G7 complete' : `◐ G7 waiting on: ${pkg.g7.missing.join(', ')}`}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          checksum {pkg.checksum.slice(0, 12)}… · {pkg.copyBlockCount} copy blocks ·{' '}
          {pkg.filePaths.length} file(s)
        </span>
      </section>
      <PromptCard title="Macaly build prompt" text={pkg.macalyPrompt} />
      <section style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Universal prompt stack:</span>
        {(['single-html', 'nextjs'] as const).map((stack) => (
          <button
            key={stack}
            onClick={() => compileUniversal.mutate({ assetId, stack })}
            disabled={compileUniversal.isPending}
            style={btn}
          >
            {stack}
          </button>
        ))}
        {compileUniversal.isError && (
          <span style={{ color: 'salmon' }}>{compileUniversal.error.message}</span>
        )}
      </section>
      <PromptCard title="Universal LLM build prompt" text={pkg.universalPrompt} />
    </div>
  );
}
