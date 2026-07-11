'use client';

import Link from 'next/link';
import { parseAutopsyReport } from '@copyforge/core';
import { trpc } from '@/trpc/react';
import { AutopsyReportView } from '@/components/AutopsyReportView';

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
const ghost = { ...btn, background: 'transparent', border: '1px solid #444', color: 'inherit' } as const;

export function AutopsyDetailPanel({ autopsyId }: { autopsyId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.autopsy.get.useQuery({ autopsyId }, { refetchInterval: 4000 });
  const invalidate = () => void utils.autopsy.get.invalidate({ autopsyId });
  const rerun = trpc.autopsy.rerun.useMutation({ onSuccess: invalidate });
  const share = trpc.autopsy.share.useMutation({ onSuccess: invalidate });
  const revoke = trpc.autopsy.revokeShare.useMutation({ onSuccess: invalidate });
  const rebuild = trpc.autopsy.rebuild.useMutation({ onSuccess: invalidate });

  const row = query.data;
  if (!row) return query.isLoading ? null : <p style={{ color: 'var(--muted)' }}>Not found.</p>;

  const report = row.status === 'complete' && row.report ? parseAutopsyReport(row.report) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: row.status === 'complete' ? 'var(--ok)' : row.status === 'failed' ? 'salmon' : 'var(--muted)', fontSize: 13 }}>
          {row.status}
        </span>
        {row.error && <span style={{ color: 'salmon', fontSize: 12 }}>{row.error}</span>}
        <button style={ghost} onClick={() => rerun.mutate({ autopsyId })} disabled={rerun.isPending}>
          Re-run teardown
        </button>
        {report && !row.shareToken && (
          <button style={btn} onClick={() => share.mutate({ autopsyId })} disabled={share.isPending}>
            Create public link
          </button>
        )}
        {row.shareToken && (
          <>
            <a href={`/a/${row.shareToken}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
              /a/{row.shareToken.slice(0, 12)}… ↗
            </a>
            <button style={ghost} onClick={() => revoke.mutate({ autopsyId })} disabled={revoke.isPending}>
              Revoke link
            </button>
          </>
        )}
        {report && !row.rebuiltProjectId && (
          <button style={btn} onClick={() => rebuild.mutate({ autopsyId })} disabled={rebuild.isPending}>
            Rebuild in CopyForge
          </button>
        )}
        {row.rebuiltProjectId && (
          <Link href={`/projects/${row.rebuiltProjectId}`} style={{ fontSize: 13 }}>
            Rebuilt project (Sales Detective pre-filled) →
          </Link>
        )}
        {(share.error ?? rebuild.error) && (
          <span style={{ color: 'salmon', fontSize: 12 }}>{(share.error ?? rebuild.error)!.message}</span>
        )}
      </section>

      {report ? (
        <AutopsyReportView report={report} />
      ) : (
        <p style={{ color: 'var(--muted)' }}>
          {row.status === 'failed' ? 'The teardown failed — fix the intake and re-run.' : 'The Council is working…'}
        </p>
      )}
    </div>
  );
}
