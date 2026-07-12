'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

const money = (cents: number, currency: string) =>
  `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

export function BillingPanel() {
  const receipts = trpc.billing.receipts.useQuery(undefined, { refetchInterval: 10_000 });
  const sub = trpc.billing.subscription.useQuery(undefined, { refetchInterval: 10_000 });
  const buyLicense = trpc.billing.buyLicense.useMutation({
    onSuccess: (r) => window.location.assign(r.url),
  });
  const buyFeed = trpc.billing.buyGenomeFeed.useMutation({
    onSuccess: (r) => window.location.assign(r.url),
  });
  const [seats, setSeats] = useState(1);

  return (
    <div className="stack">
      <section className="card row">
        <label>
          Seats:{' '}
          <input
            type="number"
            min={1}
            max={100}
            value={seats}
            onChange={(e) => setSeats(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="input"
            style={{ width: 60 }}
          />
        </label>
        <button className="btn btn-primary btn-sm" disabled={buyLicense.isPending} onClick={() => buyLicense.mutate({ seats })}>
          Buy {seats} seat{seats === 1 ? '' : 's'} — ${(seats * 1000).toLocaleString('en-US')}
        </button>
        {buyLicense.error && <span className="danger xsmall">{buyLicense.error.message}</span>}
      </section>

      <section className="card row">
        <div className="small">
          <strong>Genome Feed</strong>{' '}
          <span className={sub.data?.genomeFeed ? 'ok' : 'muted'}>
            {sub.data?.genomeFeed
              ? `active${sub.data.currentPeriodEnd ? ` · renews ${new Date(sub.data.currentPeriodEnd).toISOString().slice(0, 10)}` : ''}`
              : 'not subscribed'}
          </span>
        </div>
        {!sub.data?.genomeFeed && (
          <button className="btn btn-primary btn-sm" disabled={buyFeed.isPending} onClick={() => buyFeed.mutate()}>
            Subscribe — $79/mo
          </button>
        )}
        {buyFeed.error && <span className="danger xsmall">{buyFeed.error.message}</span>}
      </section>

      <section>
        <h2>Receipts</h2>
        {(receipts.data ?? []).map((r) => (
          <div key={r.id} className="card row small" style={{ marginBottom: '0.4rem' }}>
            <span className="muted">{new Date(r.createdAt).toISOString().slice(0, 10)}</span>
            <span>{r.description}</span>
            <span>{money(r.amountCents, r.currency)}</span>
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer">
                invoice ↗
              </a>
            )}
          </div>
        ))}
        {receipts.data && receipts.data.length === 0 && (
          <p className="muted">No receipts yet.</p>
        )}
      </section>
    </div>
  );
}
