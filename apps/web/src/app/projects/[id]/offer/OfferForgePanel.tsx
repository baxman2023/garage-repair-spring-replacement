'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

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
    <div className="stack-lg">
      <section className="row-lg">
        <button
          onClick={() => forge.mutate({ projectId })}
          disabled={forge.isPending}
          className="btn btn-primary"
        >
          {forge.isPending ? 'Queued…' : rows.length ? 'Forge new variants' : 'Run Offer Forge'}
        </button>
        {approvedId ? (
          <span className="ok">● G0 passed — offer approved.</span>
        ) : (
          <span className="muted">
            G0 pending — select a variant, complete the checklist, approve.
          </span>
        )}
        {forge.isError && <span className="danger small">{forge.error.message}</span>}
        {forge.isSuccess && !rows.length && (
          <span className="muted">Forging — variants appear here shortly.</span>
        )}
      </section>

      <section className="grid-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="card stack-sm"
            style={{
              borderColor: r.approved ? 'var(--ok)' : r.selected ? 'var(--accent)' : 'var(--border)',
            }}
          >
            <div className="spread">
              <strong>{r.offer.name || `(unnamed) v${r.version}`}</strong>
              <span className="muted">v{r.version}</span>
            </div>
            {r.offer.diagnosis && (
              <p className="muted small" style={{ margin: 0 }}>{r.offer.diagnosis}</p>
            )}
            <div className="small">
              <div>
                Stack: {r.offer.value_stack.length} item(s), $
                {r.offer.value_stack.reduce((s, i) => s + i.value_usd, 0).toLocaleString()} vs $
                {r.offer.price.amount.toLocaleString()}
              </div>
              <div>Urgency: {r.offer.urgency_mechanisms.map((u) => u.type).join(', ') || '—'}</div>
            </div>
            <div className="xsmall">
              {Object.entries(r.g0.checklist).map(([k, ok]) => (
                <span key={k} className={ok ? 'ok' : 'danger'} style={{ marginRight: 8 }}>
                  {ok ? '✓' : '✗'} {k.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 'auto' }}>
              {!r.selected && (
                <button onClick={() => select.mutate({ projectId, offerId: r.id })} className="btn">
                  Select
                </button>
              )}
              {r.selected && !r.approved && (
                <>
                  <button
                    onClick={() => approve.mutate({ projectId, offerId: r.id })}
                    disabled={approve.isPending || !r.g0.pass}
                    title={r.g0.pass ? 'Run G0 and approve' : r.g0.failures.join(' ')}
                    className="btn btn-primary"
                  >
                    Approve (G0)
                  </button>
                  <button
                    onClick={() => {
                      setDraft(JSON.stringify(r.offer, null, 2));
                      setEditing(true);
                    }}
                    className="btn"
                  >
                    Edit
                  </button>
                </>
              )}
              {r.approved && <span className="ok">Approved ✓</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="muted">No offer variants yet — run the forge.</p>
        )}
      </section>
      {approve.isError && <p className="alert alert-danger">{approve.error.message}</p>}

      {editing && selected && (
        <section className="stack-sm">
          <h3>Edit selected offer</h3>
          <textarea
            rows={18}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="textarea mono small"
          />
          <div className="row">
            <button
              onClick={() => {
                try {
                  saveEdit.mutate({ projectId, offer: JSON.parse(draft) });
                } catch {
                  alert('Not valid JSON.');
                }
              }}
              disabled={saveEdit.isPending}
              className="btn btn-primary"
            >
              {saveEdit.isPending ? 'Saving…' : 'Save as new version'}
            </button>
            <button onClick={() => setEditing(false)} className="btn">
              Cancel
            </button>
          </div>
          {saveEdit.isError && <p className="alert alert-danger">{saveEdit.error.message}</p>}
        </section>
      )}
    </div>
  );
}
