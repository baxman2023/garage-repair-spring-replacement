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
  padding: '0.35rem 0.7rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

export function ClaimsPanel({ assetId }: { assetId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.claims.list.useQuery({ assetId }, { refetchInterval: 6000 });
  const invalidate = () => void utils.claims.list.invalidate({ assetId });
  const attach = trpc.claims.attachProof.useMutation({ onSuccess: invalidate });
  const flag = trpc.claims.flag.useMutation({ onSuccess: invalidate });
  const [proofByClaim, setProofByClaim] = useState<Record<string, string>>({});

  const data = list.data;
  if (!data) return list.isLoading ? null : <p style={{ color: 'var(--muted)' }}>No data.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={box}>
          total <strong>{data.report.total}</strong>
        </div>
        <div style={box}>
          proven <strong style={{ color: 'var(--ok)' }}>{data.report.proven}</strong>
        </div>
        <div style={box}>
          flagged{' '}
          <strong style={{ color: data.report.flagged > 0 ? 'salmon' : 'var(--ok)' }}>
            {data.report.flagged}
          </strong>
        </div>
      </section>

      {data.claims.length === 0 && <p style={{ color: 'var(--muted)' }}>No claims extracted yet.</p>}

      {data.claims.map((c) => (
        <div key={c.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div>
            <span style={{ color: c.status === 'proven' ? 'var(--ok)' : 'salmon', fontWeight: 600 }}>
              {c.status === 'proven' ? '● proven' : '⚑ flagged'}
            </span>{' '}
            {c.text}
          </div>
          {c.proofRef && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>proof: {c.proofRef}</div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {c.status === 'flagged' ? (
              <>
                <select
                  value={proofByClaim[c.id] ?? ''}
                  onChange={(e) => setProofByClaim((s) => ({ ...s, [c.id]: e.target.value }))}
                  style={{ ...subtle, cursor: 'pointer' }}
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
                  style={{ ...subtle, cursor: 'text', minWidth: 220 }}
                />
                <button
                  onClick={() =>
                    attach.mutate({ assetId, claimId: c.id, proofRef: proofByClaim[c.id] ?? '' })
                  }
                  disabled={attach.isPending || !(proofByClaim[c.id] ?? '').trim()}
                  style={btn}
                >
                  Attach → proven
                </button>
              </>
            ) : (
              <button onClick={() => flag.mutate({ assetId, claimId: c.id })} disabled={flag.isPending} style={subtle}>
                Detach proof (re-flag)
              </button>
            )}
          </div>
        </div>
      ))}
      {(attach.isError || flag.isError) && (
        <p style={{ color: 'salmon' }}>{attach.error?.message ?? flag.error?.message}</p>
      )}
    </div>
  );
}
