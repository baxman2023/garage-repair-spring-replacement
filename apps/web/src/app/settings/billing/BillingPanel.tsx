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
  padding: '0.4rem 0.8rem',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#04122e',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
} as const;

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ ...box, display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>
          Seats:{' '}
          <input
            type="number"
            min={1}
            max={100}
            value={seats}
            onChange={(e) => setSeats(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            style={{ width: 60, padding: '0.3rem', borderRadius: 6, border: '1px solid #333', background: '#0b0e14', color: 'inherit' }}
          />
        </label>
        <button style={btn} disabled={buyLicense.isPending} onClick={() => buyLicense.mutate({ seats })}>
          Buy {seats} seat{seats === 1 ? '' : 's'} — ${(seats * 1000).toLocaleString('en-US')}
        </button>
        {buyLicense.error && <span style={{ color: 'salmon', fontSize: 12 }}>{buyLicense.error.message}</span>}
      </section>

      <section style={{ ...box, display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <strong>Genome Feed</strong>{' '}
          <span style={{ color: sub.data?.genomeFeed ? 'var(--ok)' : 'var(--muted)' }}>
            {sub.data?.genomeFeed
              ? `active${sub.data.currentPeriodEnd ? ` · renews ${new Date(sub.data.currentPeriodEnd).toISOString().slice(0, 10)}` : ''}`
              : 'not subscribed'}
          </span>
        </div>
        {!sub.data?.genomeFeed && (
          <button style={btn} disabled={buyFeed.isPending} onClick={() => buyFeed.mutate()}>
            Subscribe — $79/mo
          </button>
        )}
        {buyFeed.error && <span style={{ color: 'salmon', fontSize: 12 }}>{buyFeed.error.message}</span>}
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: 16 }}>Receipts</h2>
        {(receipts.data ?? []).map((r) => (
          <div key={r.id} style={{ ...box, marginBottom: '0.4rem', fontSize: 13, display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)' }}>{new Date(r.createdAt).toISOString().slice(0, 10)}</span>
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
          <p style={{ color: 'var(--muted)' }}>No receipts yet.</p>
        )}
      </section>
    </div>
  );
}
