'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

export function ClaimsPanel({ assetId }: { assetId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.claims.list.useQuery({ assetId }, { refetchInterval: 6000 });
  const invalidate = () => void utils.claims.list.invalidate({ assetId });
  const attach = trpc.claims.attachProof.useMutation({ onSuccess: invalidate });
  const flag = trpc.claims.flag.useMutation({ onSuccess: invalidate });
  const [proofByClaim, setProofByClaim] = useState<Record<string, string>>({});

  const data = list.data;
  if (!data) return list.isLoading ? null : <p className="muted">No data.</p>;

  return (
    <div className="stack">
      <section className="row-lg">
        <div className="card">
          total <strong>{data.report.total}</strong>
        </div>
        <div className="card">
          proven <strong className="ok">{data.report.proven}</strong>
        </div>
        <div className="card">
          flagged{' '}
          <strong className={data.report.flagged > 0 ? 'danger' : 'ok'}>
            {data.report.flagged}
          </strong>
        </div>
      </section>

      {data.claims.length === 0 && <p className="muted">No claims extracted yet.</p>}

      {data.claims.map((c) => (
        <div key={c.id} className="card stack-sm">
          <div>
            <span className={c.status === 'proven' ? 'badge badge-ok' : 'badge badge-danger'}>
              {c.status === 'proven' ? '● proven' : '⚑ flagged'}
            </span>{' '}
            {c.text}
          </div>
          {c.proofRef && (
            <div className="muted small">proof: {c.proofRef}</div>
          )}
          <div className="row">
            {c.status === 'flagged' ? (
              <>
                <select
                  value={proofByClaim[c.id] ?? ''}
                  onChange={(e) => setProofByClaim((s) => ({ ...s, [c.id]: e.target.value }))}
                  className="select"
                >
                  <option value="">attach proof asset…</option>
                  {data.proofAssets.map((p, i) => (
                    <option key={i} value={p.ref}>
                      [{p.type}] {p.ref}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="or type a proof ref"
                  value={proofByClaim[c.id] ?? ''}
                  onChange={(e) => setProofByClaim((s) => ({ ...s, [c.id]: e.target.value }))}
                  className="input"
                  style={{ minWidth: 220 }}
                />
                <button
                  onClick={() =>
                    attach.mutate({ assetId, claimId: c.id, proofRef: proofByClaim[c.id] ?? '' })
                  }
                  disabled={attach.isPending || !(proofByClaim[c.id] ?? '').trim()}
                  className="btn btn-primary btn-sm"
                >
                  Attach → proven
                </button>
              </>
            ) : (
              <button
                onClick={() => flag.mutate({ assetId, claimId: c.id })}
                disabled={flag.isPending}
                className="btn btn-sm"
              >
                Detach proof (re-flag)
              </button>
            )}
          </div>
        </div>
      ))}
      {(attach.isError || flag.isError) && (
        <p className="alert alert-danger">{attach.error?.message ?? flag.error?.message}</p>
      )}
    </div>
  );
}
