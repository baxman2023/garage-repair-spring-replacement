'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

export function MarketsPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const markets = trpc.markets.list.useQuery({ projectId }, { refetchInterval: 4000 });
  const invalidate = () => void utils.markets.list.invalidate({ projectId });

  const run = trpc.markets.run.useMutation();
  const swap = trpc.markets.swap.useMutation({ onSuccess: invalidate });
  const update = trpc.markets.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });
  const addManual = trpc.markets.addManual.useMutation({
    onSuccess: () => {
      setManualLabel('');
      setManualRationale('');
      invalidate();
    },
  });

  const profileAll = trpc.markets.profileAll.useMutation();
  const updateProfile = trpc.markets.updateProfile.useMutation({
    onSuccess: () => {
      setProfileEditId(null);
      invalidate();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRationale, setEditRationale] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [manualRationale, setManualRationale] = useState('');
  const [profileEditId, setProfileEditId] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState('');

  const rows = markets.data ?? [];

  return (
    <div className="stack">
      <section className="row-lg">
        <button
          onClick={() => run.mutate({ projectId })}
          disabled={run.isPending}
          className="btn btn-primary"
        >
          {run.isPending ? 'Queued…' : rows.length ? 'Re-run selection' : 'Run Market Selection'}
        </button>
        {rows.length > 0 && (
          <button
            onClick={() => profileAll.mutate({ projectId })}
            disabled={profileAll.isPending}
            className="btn btn-primary"
          >
            {profileAll.isPending ? 'Queued…' : 'Diagnose all (Schwartz profiles)'}
          </button>
        )}
        {run.isSuccess && <span className="muted">Selecting — the list refreshes automatically.</span>}
        {profileAll.isSuccess && <span className="muted">Diagnosing all markets…</span>}
        {run.isError && <span className="danger small">{run.error.message}</span>}
        {profileAll.isError && <span className="danger small">{profileAll.error.message}</span>}
        {rows.some((r) => r.origin === 'user') && (
          <span className="muted">Your edited markets survive re-runs.</span>
        )}
      </section>

      <section className="stack-sm">
        {rows.map((m, idx) => (
          <div key={m.id} className="card" style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ fontSize: 22, fontWeight: 700, minWidth: 34, color: 'var(--accent)' }}>
              #{m.rank}
            </div>
            <div className="stack-sm" style={{ flex: 1 }}>
              {editingId === m.id ? (
                <>
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="input"
                  />
                  <textarea
                    rows={3}
                    value={editRationale}
                    onChange={(e) => setEditRationale(e.target.value)}
                    className="textarea"
                  />
                  <div className="row">
                    <button
                      onClick={() =>
                        update.mutate({ projectId, marketId: m.id, label: editLabel, rationale: editRationale })
                      }
                      disabled={update.isPending}
                      className="btn btn-primary"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="btn">
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="spread">
                    <strong>
                      {m.label}{' '}
                      {m.origin === 'user' && (
                        <span className="ok" style={{ fontWeight: 400 }}>(yours)</span>
                      )}
                    </strong>
                    <span className="muted">
                      {m.scoreTotal !== null ? `${m.scoreTotal}/100` : 'unscored'}
                    </span>
                  </div>
                  {m.avatarHint && <div className="muted small">{m.avatarHint}</div>}
                  <div className="small">{m.rationale}</div>
                  {m.scores && (
                    <div className="muted xsmall">
                      {Object.entries(m.scores)
                        .map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`)
                        .join(' · ')}
                    </div>
                  )}
                  <div className="xsmall">
                    {m.diagnosed ? (
                      <span className="ok">
                        ✓ diagnosed — {String((m.profile as { awareness_stage?: string }).awareness_stage)} /
                        soph {String((m.profile as { sophistication?: number }).sophistication)}
                      </span>
                    ) : (
                      <span className="muted">not yet diagnosed</span>
                    )}{' '}
                    <button
                      onClick={() => {
                        setProfileEditId(m.id);
                        setProfileDraft(JSON.stringify(m.profile, null, 2));
                      }}
                      className="btn btn-sm"
                    >
                      profile JSON
                    </button>
                  </div>
                  {profileEditId === m.id && (
                    <div className="stack-sm">
                      <textarea
                        rows={14}
                        value={profileDraft}
                        onChange={(e) => setProfileDraft(e.target.value)}
                        className="textarea mono xsmall"
                      />
                      <div className="row">
                        <button
                          onClick={() => {
                            try {
                              updateProfile.mutate({ projectId, marketId: m.id, profile: JSON.parse(profileDraft) });
                            } catch {
                              alert('Not valid JSON.');
                            }
                          }}
                          disabled={updateProfile.isPending}
                          className="btn btn-primary"
                        >
                          Save profile
                        </button>
                        <button onClick={() => setProfileEditId(null)} className="btn">
                          Close
                        </button>
                      </div>
                      {updateProfile.isError && (
                        <p className="alert alert-danger">{updateProfile.error.message}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="stack-sm">
              <button
                onClick={() => idx > 0 && swap.mutate({ projectId, marketIdA: m.id, marketIdB: rows[idx - 1]!.id })}
                disabled={idx === 0 || swap.isPending}
                className="btn btn-sm"
              >
                ↑
              </button>
              <button
                onClick={() =>
                  idx < rows.length - 1 && swap.mutate({ projectId, marketIdA: m.id, marketIdB: rows[idx + 1]!.id })
                }
                disabled={idx === rows.length - 1 || swap.isPending}
                className="btn btn-sm"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  setEditingId(m.id);
                  setEditLabel(m.label);
                  setEditRationale(m.rationale ?? '');
                }}
                className="btn btn-sm"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">No markets yet — run the selection engine.</p>}
      </section>

      <section className="stack-sm" style={{ maxWidth: 640 }}>
        <h3 style={{ margin: 0 }}>Add a market manually</h3>
        <input
          placeholder="Segment label…"
          value={manualLabel}
          onChange={(e) => setManualLabel(e.target.value)}
          className="input"
        />
        <textarea
          rows={2}
          placeholder="Why this crowd…"
          value={manualRationale}
          onChange={(e) => setManualRationale(e.target.value)}
          className="textarea"
        />
        <div>
          <button
            onClick={() => addManual.mutate({ projectId, label: manualLabel, rationale: manualRationale })}
            disabled={addManual.isPending || !manualLabel.trim() || !manualRationale.trim()}
            className="btn btn-primary"
          >
            Add market
          </button>
        </div>
        {addManual.isError && <p className="alert alert-danger">{addManual.error.message}</p>}
      </section>
    </div>
  );
}
