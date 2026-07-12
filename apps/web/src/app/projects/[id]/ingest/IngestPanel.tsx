'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

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
  if (!data) return settings.isLoading ? null : <p className="muted">No data.</p>;

  return (
    <div className="stack">
      <section className="card small">
        <strong>Ingest key & endpoints</strong>{' '}
        <button onClick={() => rotate.mutate({ projectId })} disabled={rotate.isPending} className="btn btn-sm">
          Rotate key
        </button>
        <div className="muted" style={{ marginTop: 6 }}>
          <div>Ringba webhook: <code>{data.endpoints.ringba}</code></div>
          <div>Pixel/webhook: <code>{data.endpoints.pixel}</code></div>
        </div>
      </section>

      <section className="card small">
        <strong>Ringba campaign → market map</strong>
        {data.campaignMaps.map((m) => {
          const market = data.markets.find((x) => x.id === m.marketId);
          return (
            <div key={m.id} style={{ marginTop: 4 }}>
              <code>{m.campaign}</code> → #{market?.rank} {market?.label}
            </div>
          );
        })}
        <div className="row" style={{ marginTop: 8 }}>
          <input
            placeholder="campaign name"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className="input"
            style={{ minWidth: 200 }}
          />
          <select value={marketId} onChange={(e) => setMarketId(e.target.value)} className="select">
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
            className="btn btn-primary btn-sm"
          >
            Map campaign
          </button>
        </div>
      </section>

      <section className="card small">
        <strong>Email metrics CSV</strong>
        <div className="muted" style={{ margin: '4px 0' }}>
          Header: <code>email,type,occurred_at[,market_id]</code> — type open|click.
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={4}
          className="textarea mono"
          style={{ width: '100%' }}
        />
        <button
          onClick={() => importCsv.mutate({ projectId, csv })}
          disabled={importCsv.isPending || !csv.trim()}
          className="btn btn-primary btn-sm"
          style={{ marginTop: 6 }}
        >
          Import
        </button>
        {importCsv.data && (
          <span className="muted" style={{ marginLeft: 8 }}>
            {importCsv.data.recorded} recorded · {importCsv.data.duplicates} duplicates ·{' '}
            {importCsv.data.triaged} triaged
          </span>
        )}
      </section>

      <section className="card small">
        <strong>Triage queue</strong>{' '}
        <span className={data.triage.length > 0 ? 'warn' : 'ok'}>
          {data.triage.length} pending
        </span>
        {data.triage.map((t) => (
          <div key={t.id} style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <span className="warn">[{t.source}]</span> {t.reason}
            <pre className="muted" style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: '4px 0' }}>
              {JSON.stringify(t.payload)}
            </pre>
            <button
              onClick={() => resolve.mutate({ triageId: t.id, status: 'resolved' })}
              disabled={resolve.isPending}
              className="btn btn-sm"
            >
              Mark resolved
            </button>{' '}
            <button
              onClick={() => resolve.mutate({ triageId: t.id, status: 'discarded' })}
              disabled={resolve.isPending}
              className="btn btn-sm"
            >
              Discard
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
