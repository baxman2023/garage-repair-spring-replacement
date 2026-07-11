import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  applyEngineCandidates,
  applyMarketProfile,
  assertG2Approved,
  buildStrategySnapshot,
  closePool,
  gateReports,
  getDb,
  getG2Status,
  listMarkets,
  projects,
  recordG2,
  tenantDb,
  updateMarket,
} from './index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[strategyGate.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const DIAGNOSIS = (rank: number, label: string) => ({
  schema_version: '1',
  rank,
  label,
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'door screeching' },
  starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 70 },
  awareness_stage: 'problem' as const,
  awareness_justification: 'Feels the symptom daily.',
  sophistication: 2,
  sophistication_justification: 'Low claim exposure.',
  resident_emotion: 'quiet dread',
  core_desire: 'never think about it again',
  objections: ['diy', 'upsells', 'quality', 'price', 'trust'],
  voc_corpus_ref: '',
  channels_ranked: ['search'],
  entry_conversation: 'Is this going to snap?',
});

async function setupDiagnosed(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'G2 test' });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({
      label: `Mkt ${i + 1}`,
      rationale: 'starving',
      total: 80 - i,
      profile: { scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4 } },
    })),
  });
  const rows = await listMarkets(workspaceId, projectId);
  for (const m of rows) {
    await applyMarketProfile({
      workspaceId,
      projectId,
      marketId: m.id,
      profile: DIAGNOSIS(m.rank, m.label),
    });
  }
  return { workspaceId, projectId };
}

describe('Strategy Review G2 (WO-015)', () => {
  it('fan-out is unreachable until approved; approval unlocks it', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupDiagnosed();
    await expect(assertG2Approved(workspaceId, projectId)).rejects.toThrow(/G2 required/);

    const snapshot = await buildStrategySnapshot(workspaceId, projectId);
    expect(snapshot.markets.length).toBe(5);
    await recordG2({ workspaceId, projectId, snapshot });

    await assertG2Approved(workspaceId, projectId); // no throw
    const status = await getG2Status(workspaceId, projectId);
    expect(status.approved).toBe(true);
    expect(status.approvedHash).toBe(status.currentHash);
  });

  it('refuses to snapshot an undiagnosed or short slate', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'short' });
    await expect(buildStrategySnapshot(workspaceId, projectId)).rejects.toThrow(/5 markets/);

    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: Array.from({ length: 8 }, (_v, i) => ({
        label: `U${i}`,
        rationale: 'r',
        total: 50,
        profile: {},
      })),
    });
    await expect(buildStrategySnapshot(workspaceId, projectId)).rejects.toThrow(/not fully diagnosed/);
  });

  it('post-approval edits make G2 stale until re-approved; snapshots stay immutable', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupDiagnosed();
    const first = await buildStrategySnapshot(workspaceId, projectId);
    await recordG2({ workspaceId, projectId, snapshot: first });
    await assertG2Approved(workspaceId, projectId);

    // Edit a market (label change alters its profile? label lives on the row AND
    // in the profile snapshot — profile carries label; updateMarket changes row
    // label but profile JSON label stays… so hash source must change: edit profile).
    const rows = await listMarkets(workspaceId, projectId);
    await applyMarketProfile({
      workspaceId,
      projectId,
      marketId: rows[0]!.id,
      profile: { ...DIAGNOSIS(rows[0]!.rank, rows[0]!.label), resident_emotion: 'fresh fury' },
    });

    const status = await getG2Status(workspaceId, projectId);
    expect(status.approved).toBe(false);
    expect(status.stale).toBe(true);
    await expect(assertG2Approved(workspaceId, projectId)).rejects.toThrow(/stale/);

    // The recorded snapshot did not drift with the edit (immutable).
    const reports = await getDb()
      .select()
      .from(gateReports)
      .where(eq(gateReports.projectId, projectId));
    const g2 = reports.filter((r) => r.gate === 'G2');
    expect(g2.length).toBe(1);
    const stored = g2[0]!.report as { hash: string; markets: Array<{ resident_emotion: string }> };
    expect(stored.hash).toBe(first.hash);
    expect(stored.markets[0]!.resident_emotion).toBe('quiet dread');

    // Re-approval records a NEW report; the old row is untouched.
    const second = await buildStrategySnapshot(workspaceId, projectId);
    await recordG2({ workspaceId, projectId, snapshot: second });
    await assertG2Approved(workspaceId, projectId);
    const after = (
      await getDb().select().from(gateReports).where(eq(gateReports.projectId, projectId))
    ).filter((r) => r.gate === 'G2');
    expect(after.length).toBe(2);
    expect((after.find((r) => r.id === g2[0]!.id)!.report as { hash: string }).hash).toBe(first.hash);
  });

  it('user label edits (row-level) also invalidate the approval', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupDiagnosed();
    const snapshot = await buildStrategySnapshot(workspaceId, projectId);
    await recordG2({ workspaceId, projectId, snapshot });
    await assertG2Approved(workspaceId, projectId);

    // updateMarket syncs the label into the profile JSON, so the hash moves.
    const rows = await listMarkets(workspaceId, projectId);
    await updateMarket({ workspaceId, projectId, marketId: rows[2]!.id, label: 'Renamed crowd' });

    const status = await getG2Status(workspaceId, projectId);
    expect(status.approved).toBe(false);
    expect(status.stale).toBe(true);
  });
});
