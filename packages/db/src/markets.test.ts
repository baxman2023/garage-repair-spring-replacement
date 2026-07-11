import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  addManualMarket,
  applyEngineCandidates,
  closePool,
  getDb,
  listMarkets,
  projects,
  swapMarketRanks,
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
    console.warn('[markets.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Markets test' });
  return { workspaceId, projectId };
}

const cand = (label: string, total: number) => ({
  label,
  rationale: `${label} rationale`,
  total,
  profile: { scores: { pain: 5 } },
});

describe('markets store (WO-012)', () => {
  it('persists top 5 with rank, score, and rationale', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: [78, 71, 66, 60, 55, 40, 33].map((t, i) => cand(`M${i + 1}`, t)),
    });
    const rows = await listMarkets(workspaceId, projectId);
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.label)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(Number(rows[0]!.scoreTotal)).toBeCloseTo(78, 1);
    expect(rows.every((r) => (r.rationale ?? '').length > 0)).toBe(true);
  });

  it('user edits survive re-runs (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: [90, 80, 70, 60, 50, 40, 30, 20].map((t, i) => cand(`Run1-${i + 1}`, t)),
    });
    let rows = await listMarkets(workspaceId, projectId);

    // User edits rank 2 and adds nothing else.
    await updateMarket({
      workspaceId,
      projectId,
      marketId: rows[1]!.id,
      label: 'My handpicked crowd',
      rationale: 'I know these buyers personally.',
    });

    // Re-run with a fresh engine batch.
    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: [88, 77, 66, 55, 44, 33, 22, 11].map((t, i) => cand(`Run2-${i + 1}`, t)),
    });
    rows = await listMarkets(workspaceId, projectId);
    expect(rows.length).toBe(5);
    const rank2 = rows.find((r) => r.rank === 2)!;
    expect(rank2.label).toBe('My handpicked crowd'); // survived
    expect((rank2.profile as { origin?: string }).origin).toBe('user');
    // Other ranks are fresh engine rows.
    expect(rows.filter((r) => r.label.startsWith('Run2-')).length).toBe(4);
  });

  it('swap exchanges ranks', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: Array.from({ length: 8 }, (_v, i) => cand(`S${i + 1}`, 80 - i * 5)),
    });
    let rows = await listMarkets(workspaceId, projectId);
    await swapMarketRanks({
      workspaceId,
      projectId,
      marketIdA: rows[0]!.id,
      marketIdB: rows[4]!.id,
    });
    rows = await listMarkets(workspaceId, projectId);
    expect(rows.find((r) => r.rank === 1)!.label).toBe('S5');
    expect(rows.find((r) => r.rank === 5)!.label).toBe('S1');
  });

  it('manual add fills a free rank, then displaces the worst engine row, and refuses when all-user', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    // Free-rank case.
    const first = await addManualMarket({ workspaceId, projectId, label: 'Manual A', rationale: 'gut' });
    let rows = await listMarkets(workspaceId, projectId);
    expect(rows.find((r) => r.id === first)!.rank).toBe(1);

    // Fill the rest with engine rows, then displace.
    await applyEngineCandidates({
      workspaceId,
      projectId,
      candidates: Array.from({ length: 8 }, (_v, i) => cand(`E${i + 1}`, 70 - i)),
    });
    await addManualMarket({ workspaceId, projectId, label: 'Manual B', rationale: 'gut' });
    rows = await listMarkets(workspaceId, projectId);
    expect(rows.length).toBe(5);
    expect(rows.some((r) => r.label === 'Manual B')).toBe(true);

    // Make everything user-origin → further adds refuse.
    for (const r of rows) {
      await updateMarket({ workspaceId, projectId, marketId: r.id, rationale: 'kept' });
    }
    await expect(
      addManualMarket({ workspaceId, projectId, label: 'One too many', rationale: 'x' }),
    ).rejects.toThrow(/user-defined/);
  });
});
