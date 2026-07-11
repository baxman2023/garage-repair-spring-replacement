'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
  color: 'var(--fg)',
} as const;
const btn = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
} as const;
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

export function OfferForgePanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const offers = trpc.offers.list.useQuery({ projectId }, { refetchInterval: 4000 });
  const status = trpc.offers.status.useQuery({ projectId });

  const forge = trpc.offers.forge.useMutation();
  const select = trpc.offers.select.useMutation({
    onSuccess: () => void utils.offers.list.invalidate({ projectId }),
  });
  const approve = trpc.offers.approve.useMutation({
    onSuccess: () => {
      void utils.offers.list.invalidate({ projectId });
      void utils.offers.status.invalidate({ projectId });
    },
  });
  const saveEdit = trpc.offers.saveEdit.useMutation({
    onSuccess: () => {
      setEditing(false);
      void utils.offers.list.invalidate({ projectId });
    },
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const rows = offers.data ?? [];
  const selected = rows.find((r) => r.selected);
  const approvedId = status.data?.approvedOfferId ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => forge.mutate({ projectId })} disabled={forge.isPending} style={btn}>
          {forge.isPending ? 'Queued…' : rows.length ? 'Forge new variants' : 'Run Offer Forge'}
        </button>
        {approvedId ? (
          <span style={{ color: 'var(--ok)' }}>● G0 passed — offer approved.</span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>
            G0 pending — select a variant, complete the checklist, approve.
          </span>
        )}
        {forge.isError && <span style={{ color: 'salmon' }}>{forge.error.message}</span>}
        {forge.isSuccess && !rows.length && (
          <span style={{ color: 'var(--muted)' }}>Forging — variants appear here shortly.</span>
        )}
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              ...box,
              borderColor: r.approved ? 'var(--ok)' : r.selected ? 'var(--accent)' : '#333',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{r.offer.name || `(unnamed) v${r.version}`}</strong>
              <span style={{ color: 'var(--muted)' }}>v{r.version}</span>
            </div>
            {r.offer.diagnosis && (
              <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>{r.offer.diagnosis}</p>
            )}
            <div style={{ fontSize: 13 }}>
              <div>
                Stack: {r.offer.value_stack.length} item(s), $
                {r.offer.value_stack.reduce((s, i) => s + i.value_usd, 0).toLocaleString()} vs $
                {r.offer.price.amount.toLocaleString()}
              </div>
              <div>Urgency: {r.offer.urgency_mechanisms.map((u) => u.type).join(', ') || '—'}</div>
            </div>
            <div style={{ fontSize: 12 }}>
              {Object.entries(r.g0.checklist).map(([k, ok]) => (
                <span key={k} style={{ marginRight: 8, color: ok ? 'var(--ok)' : 'salmon' }}>
                  {ok ? '✓' : '✗'} {k.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', flexWrap: 'wrap' }}>
              {!r.selected && (
                <button onClick={() => select.mutate({ projectId, offerId: r.id })} style={subtle}>
                  Select
                </button>
              )}
              {r.selected && !r.approved && (
                <>
                  <button
                    onClick={() => approve.mutate({ projectId, offerId: r.id })}
                    disabled={approve.isPending || !r.g0.pass}
                    title={r.g0.pass ? 'Run G0 and approve' : r.g0.failures.join(' ')}
                    style={{ ...btn, opacity: r.g0.pass ? 1 : 0.5 }}
                  >
                    Approve (G0)
                  </button>
                  <button
                    onClick={() => {
                      setDraft(JSON.stringify(r.offer, null, 2));
                      setEditing(true);
                    }}
                    style={subtle}
                  >
                    Edit
                  </button>
                </>
              )}
              {r.approved && <span style={{ color: 'var(--ok)' }}>Approved ✓</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No offer variants yet — run the forge.</p>
        )}
      </section>
      {approve.isError && <p style={{ color: 'salmon' }}>{approve.error.message}</p>}

      {editing && selected && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <h3>Edit selected offer</h3>
          <textarea
            rows={18}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ ...box, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => {
                try {
                  saveEdit.mutate({ projectId, offer: JSON.parse(draft) });
                } catch {
                  alert('Not valid JSON.');
                }
              }}
              disabled={saveEdit.isPending}
              style={btn}
            >
              {saveEdit.isPending ? 'Saving…' : 'Save as new version'}
            </button>
            <button onClick={() => setEditing(false)} style={subtle}>
              Cancel
            </button>
          </div>
          {saveEdit.isError && <p style={{ color: 'salmon' }}>{saveEdit.error.message}</p>}
        </section>
      )}
    </div>
  );
}
