'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

function PromptCard({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="card stack-sm">
      <div className="spread">
        <strong>{title}</strong>
        {text ? (
          <button onClick={() => void copy()} className="btn btn-primary btn-sm">
            {copied ? 'Copied ✓' : 'Copy to clipboard'}
          </button>
        ) : (
          <span className="muted small">not compiled yet</span>
        )}
      </div>
      {text && (
        <>
          <span className="muted xsmall">{text.length.toLocaleString()} chars</span>
          <pre
            className="xsmall"
            style={{
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
      <p className="muted">No package composed yet — the G7 composer runs after compliance.</p>
    );
  }

  return (
    <div className="stack">
      <section className="row-lg">
        <span className={pkg.g7.pass ? 'badge badge-ok' : 'badge badge-warn'}>
          {pkg.g7.pass ? '● G7 complete' : `◐ G7 waiting on: ${pkg.g7.missing.join(', ')}`}
        </span>
        <span className="muted small">
          checksum {pkg.checksum.slice(0, 12)}… · {pkg.copyBlockCount} copy blocks ·{' '}
          {pkg.filePaths.length} file(s)
        </span>
      </section>
      <PromptCard title="Macaly build prompt" text={pkg.macalyPrompt} />
      <section className="row">
        <span className="muted small">Universal prompt stack:</span>
        {(['single-html', 'nextjs'] as const).map((stack) => (
          <button
            key={stack}
            onClick={() => compileUniversal.mutate({ assetId, stack })}
            disabled={compileUniversal.isPending}
            className="btn btn-primary btn-sm"
          >
            {stack}
          </button>
        ))}
        {compileUniversal.isError && (
          <span className="danger small">{compileUniversal.error.message}</span>
        )}
      </section>
      <PromptCard title="Universal LLM build prompt" text={pkg.universalPrompt} />
    </div>
  );
}
