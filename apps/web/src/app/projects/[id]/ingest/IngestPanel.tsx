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
const subtle = { ...btn, background: 'transparent', color: 'var(--muted)', border: '1px solid #333' } as const;

export function IngestPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const settings = trpc.ingest.settings.useQuery({ projectId }, { refetchInterval: 6000 });
  const invalidate = () => void utils.ingest.settings.invalidate({ projectId });
  const rotate = trpc.ingest.rotateKey.useMutation({ onSuccess: invalidate });
  const setMap = trpc.ingest.setCampaignMap.useMutation({ onSuccess: invalidate });
  const resolve = trpc.ingest.resolveTriage.useMutation({ onSuccess: invalidate });
  const importCsv = trpc.ingest.importEmailCsv.useMutation({ onSuccess: invalidate });

  const [campaign, setCampaign] = useState('');
  const [marketId, setMarketId] = useState('');
  const [csv, setCsv] = useState('');

  const data = settings.data;
  if (!data) return settings.isLoading ? null : <p style={{ color: 'var(--muted)' }}>No data.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section style={{ ...box, fontSize: 13 }}>
        <strong>Ingest key & endpoints</strong>{' '}
        <button onClick={() => rotate.mutate({ projectId })} disabled={rotate.isPending} style={subtle}>
          Rotate key
        </button>
        <div style={{ marginTop: 6, color: 'var(--muted)' }}>
          <div>Ringba webhook: <code>{data.endpoints.ringba}</code></div>
          <div>Pixel/webhook: <code>{data.endpoints.pixel}</code></div>
        </div>
      </section>

      <section style={{ ...box, fontSize: 13 }}>
        <strong>Ringba campaign → market map</strong>
        {data.campaignMaps.map((m) => {
          const market = data.markets.find((x) => x.id === m.marketId);
          return (
            <div key={m.id} style={{ marginTop: 4 }}>
              <code>{m.campaign}</code> → #{market?.rank} {market?.label}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 8, flexWrap: 'wrap' }}>
          <input
            placeholder="campaign name"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            style={{ ...subtle, cursor: 'text', minWidth: 200 }}
          />
          <select value={marketId} onChange={(e) => setMarketId(e.target.value)} style={subtle}>
            <option value="">market…</option>
            {data.markets.map((m) => (
              <option key={m.id} value={m.id}>
                #{m.rank} {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setMap.mutate({ projectId, campaign: campaign.trim(), marketId })}
            disabled={setMap.isPending || !campaign.trim() || !marketId}
            style={btn}
          >
            Map campaign
          </button>
        </div>
      </section>

      <section style={{ ...box, fontSize: 13 }}>
        <strong>Email metrics CSV</strong>
        <div style={{ color: 'var(--muted)', margin: '4px 0' }}>
          Header: <code>email,type,occurred_at[,market_id]</code> — type open|click.
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={4}
          style={{ ...subtle, cursor: 'text', width: '100%', fontFamily: 'monospace' }}
        />
        <button
          onClick={() => importCsv.mutate({ projectId, csv })}
          disabled={importCsv.isPending || !csv.trim()}
          style={{ ...btn, marginTop: 6 }}
        >
          Import
        </button>
        {importCsv.data && (
          <span style={{ marginLeft: 8, color: 'var(--muted)' }}>
            {importCsv.data.recorded} recorded · {importCsv.data.duplicates} duplicates ·{' '}
            {importCsv.data.triaged} triaged
          </span>
        )}
      </section>

      <section style={{ ...box, fontSize: 13 }}>
        <strong>Triage queue</strong>{' '}
        <span style={{ color: data.triage.length > 0 ? '#f0c674' : 'var(--ok)' }}>
          {data.triage.length} pending
        </span>
        {data.triage.map((t) => (
          <div key={t.id} style={{ marginTop: 6, borderTop: '1px solid #262a33', paddingTop: 6 }}>
            <span style={{ color: '#f0c674' }}>[{t.source}]</span> {t.reason}
            <pre style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap', margin: '4px 0' }}>
              {JSON.stringify(t.payload)}
            </pre>
            <button
              onClick={() => resolve.mutate({ triageId: t.id, status: 'resolved' })}
              disabled={resolve.isPending}
              style={subtle}
            >
              Mark resolved
            </button>{' '}
            <button
              onClick={() => resolve.mutate({ triageId: t.id, status: 'discarded' })}
              disabled={resolve.isPending}
              style={subtle}
            >
              Discard
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
