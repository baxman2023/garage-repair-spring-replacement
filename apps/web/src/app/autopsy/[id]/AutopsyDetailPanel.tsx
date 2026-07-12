'use client';

import Link from 'next/link';
import { parseAutopsyReport } from '@copyforge/core';
import { trpc } from '@/trpc/react';
import { AutopsyReportView } from '@/components/AutopsyReportView';

export function AutopsyDetailPanel({ autopsyId }: { autopsyId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.autopsy.get.useQuery({ autopsyId }, { refetchInterval: 4000 });
  const invalidate = () => void utils.autopsy.get.invalidate({ autopsyId });
  const rerun = trpc.autopsy.rerun.useMutation({ onSuccess: invalidate });
  const share = trpc.autopsy.share.useMutation({ onSuccess: invalidate });
  const revoke = trpc.autopsy.revokeShare.useMutation({ onSuccess: invalidate });
  const rebuild = trpc.autopsy.rebuild.useMutation({ onSuccess: invalidate });

  const row = query.data;
  if (!row) return query.isLoading ? null : <p className="muted">Not found.</p>;

  const report = row.status === 'complete' && row.report ? parseAutopsyReport(row.report) : null;

  return (
    <div className="stack">
      <section className="row">
        <span
          className={
            row.status === 'complete'
              ? 'badge badge-ok'
              : row.status === 'failed'
                ? 'badge badge-danger'
                : 'badge badge-warn'
          }
        >
          {row.status}
        </span>
        {row.error && <span className="danger xsmall">{row.error}</span>}
        <button className="btn btn-sm" onClick={() => rerun.mutate({ autopsyId })} disabled={rerun.isPending}>
          Re-run teardown
        </button>
        {report && !row.shareToken && (
          <button className="btn btn-primary btn-sm" onClick={() => share.mutate({ autopsyId })} disabled={share.isPending}>
            Create public link
          </button>
        )}
        {row.shareToken && (
          <>
            <a href={`/a/${row.shareToken}`} target="_blank" rel="noreferrer" className="small">
              /a/{row.shareToken.slice(0, 12)}… ↗
            </a>
            <button className="btn btn-sm" onClick={() => revoke.mutate({ autopsyId })} disabled={revoke.isPending}>
              Revoke link
            </button>
          </>
        )}
        {report && !row.rebuiltProjectId && (
          <button className="btn btn-primary btn-sm" onClick={() => rebuild.mutate({ autopsyId })} disabled={rebuild.isPending}>
            Rebuild in CopyForge
          </button>
        )}
        {row.rebuiltProjectId && (
          <Link href={`/projects/${row.rebuiltProjectId}`} className="small">
            Rebuilt project (Sales Detective pre-filled) →
          </Link>
        )}
        {(share.error ?? rebuild.error) && (
          <span className="danger xsmall">{(share.error ?? rebuild.error)!.message}</span>
        )}
      </section>

      {report ? (
        <AutopsyReportView report={report} />
      ) : (
        <p className="muted">
          {row.status === 'failed' ? 'The teardown failed — fix the intake and re-run.' : 'The Council is working…'}
        </p>
      )}
    </div>
  );
}
