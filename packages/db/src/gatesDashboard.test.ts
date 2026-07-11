import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { createAsset, recordAssetGate, setAssetStatus } from './assetsStore.js';
import { approveAsset, blockAsset, gateReportDetail, overrideGate, projectGateGrid } from './gatesDashboard.js';
import { auditLog, gateReports, jobs, markets, projects, assets as assetsTable } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[gatesDashboard.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Gates test' });
  const marketId = await tenantDb(workspaceId).insert(markets, {
    projectId,
    rank: 1,
    label: 'M1',
    schemaVersion: '1',
    profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, marketId };
}

describe('gate dashboard (WO-033)', () => {
  it('grid shows per-asset G3-G7 states from the latest reports', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const a1 = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
    const a2 = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
    await recordAssetGate({ workspaceId, assetId: a1, gate: 'G3', pass: true, report: { aggregate: 84 } });
    await recordAssetGate({ workspaceId, assetId: a2, gate: 'G5', pass: false, report: { failures: ['x'] } });
    await recordAssetGate({ workspaceId, assetId: a2, gate: 'G5', pass: true, report: { loops: 2 } });

    const grid = await projectGateGrid(workspaceId, projectId);
    expect(grid).toHaveLength(2);
    const row1 = grid.find((r) => r.assetId === a1)!;
    expect(row1.gates.G3).toMatchObject({ pass: true, overridden: false });
    expect(row1.gates.G4).toBeNull();
    const row2 = grid.find((r) => r.assetId === a2)!;
    expect(row2.gates.G5!.pass).toBe(true); // the LATEST report wins

    const detail = await gateReportDetail(workspaceId, a2, 'G5');
    expect(detail!.pass).toBe(true);
    expect(detail!.report).toEqual({ loops: 2 });
  });

  it('override writes gate_reports.overridden_by + audit_log, resumes the flow, re-enqueues the next gate (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
    // A G5 escalation left it blocked.
    await setAssetStatus(workspaceId, assetId, 'council');
    await setAssetStatus(workspaceId, assetId, 'blocked');
    const ownerId = newId();

    await overrideGate({ workspaceId, assetId, gate: 'G5', actorUserId: ownerId, reason: 'legal reviewed the draft' });

    const reports = await tenantDb(workspaceId).findMany(gateReports, eq(gateReports.assetId, assetId));
    const overridden = reports.find((r) => r.gate === 'G5')!;
    expect(overridden.pass).toBe(true);
    expect(overridden.overriddenByUserId).toBe(ownerId); // gate_reports.overridden_by
    expect(overridden.overrideReason).toBe('legal reviewed the draft');

    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, assetId), eq(auditLog.action, 'gate.override')));
    expect(audits).toHaveLength(1); // audit_log row
    expect(audits[0]!.actorUserId).toBe(ownerId);
    expect((audits[0]!.meta as { reason: string }).reason).toBe('legal reviewed the draft');

    // Resumed at the post-G5 stage and the G6 job is queued.
    const asset = await tenantDb(workspaceId).findFirst(assetsTable, eq(assetsTable.id, assetId));
    expect(asset!.status).toBe('compliance');
    const queued = await getDb().select().from(jobs).where(eq(jobs.workspaceId, workspaceId));
    expect(queued.some((j) => j.type === 'asset.compliance' && (j.payload as { assetId: string }).assetId === assetId)).toBe(true);

    // The grid marks the cell as an override.
    const grid = await projectGateGrid(workspaceId, projectId);
    expect(grid[0]!.gates.G5).toMatchObject({ pass: true, overridden: true });
  });

  it('override requires a reason', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
    await expect(
      overrideGate({ workspaceId, assetId, gate: 'G3', actorUserId: newId(), reason: '  ' }),
    ).rejects.toThrow(/reason is required/);
  });

  it('block and approve are audited status actions', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
    const ownerId = newId();

    await blockAsset({ workspaceId, assetId, actorUserId: ownerId, reason: 'legal hold' });
    expect(
      (await tenantDb(workspaceId).findFirst(assetsTable, eq(assetsTable.id, assetId)))!.status,
    ).toBe('blocked');

    // Approve path: walk a second asset to packaging, then approve.
    const a2 = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
    for (const s of ['council', 'focus_group', 'deslop', 'compliance', 'packaging'] as const) {
      await setAssetStatus(workspaceId, a2, s);
    }
    await approveAsset({ workspaceId, assetId: a2, actorUserId: ownerId });
    expect(
      (await tenantDb(workspaceId).findFirst(assetsTable, eq(assetsTable.id, a2)))!.status,
    ).toBe('approved');

    const audits = await getDb().select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['asset.block', 'asset.approve']),
    );
  });
});
