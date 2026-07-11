import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { createAsset, setAssetStatus } from './assetsStore.js';
import { approveAsset } from './gatesDashboard.js';
import { recordEvent } from './eventsStore.js';
import {
  armMetrics,
  controlLineage,
  createChallenger,
  designateControlIfFirst,
  markChallengerLost,
  promoteChallenger,
  setChallengerLive,
} from './controlsStore.js';
import { auditLog, challengers, controls, markets, projects } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[controlsStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const TEST_CONFIG = { minSampleSize: 20, minUplift: 0.1, zThreshold: 1.64 };

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Controls test' });
  const marketId = await tenantDb(workspaceId).insert(markets, {
    projectId,
    rank: 1,
    label: 'M1',
    schemaVersion: '1',
    profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, marketId };
}

async function approvedAsset(workspaceId: string, projectId: string, marketId: string): Promise<string> {
  const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  for (const s of ['council', 'focus_group', 'deslop', 'compliance', 'packaging'] as const) {
    await setAssetStatus(workspaceId, assetId, s);
  }
  await approveAsset({ workspaceId, assetId, actorUserId: newId() });
  return assetId;
}

/** Seed ledger arms: page_views + sales for one asset (salt keeps keys unique per call). */
async function seedArm(
  workspaceId: string,
  projectId: string,
  assetId: string,
  visitors: number,
  sales: number,
  salt = 'a',
) {
  for (let i = 0; i < visitors; i++) {
    await recordEvent({
      workspaceId, projectId, assetId, type: 'page_view', source: 'pixel',
      sessionRef: `s-${assetId.slice(-6)}-${salt}-${i}`, dedupeKey: `pv:${assetId}:${salt}:${i}`,
    });
  }
  for (let i = 0; i < sales; i++) {
    await recordEvent({
      workspaceId, projectId, assetId, type: 'sale', source: 'pixel',
      sessionRef: `s-${assetId.slice(-6)}-${salt}-${i}`, dedupeKey: `sale:${assetId}:${salt}:${i}`,
    });
  }
}

describe('controls & challengers (WO-044)', () => {
  it('the first approved asset auto-designates as control; later approvals never steal it', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const first = await approvedAsset(workspaceId, projectId, marketId);
    const second = await approvedAsset(workspaceId, projectId, marketId);

    const rows = await tenantDb(workspaceId).findMany(
      controls,
      and(eq(controls.projectId, projectId), eq(controls.marketId, marketId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assetId).toBe(first);
    expect(rows[0]!.assetId).not.toBe(second);

    const lineage = await controlLineage(workspaceId, rows[0]!.id);
    expect(lineage[0]!.action).toBe('control.designated');
  });

  it('promotion is impossible below min volume; above it the control swaps with immutable history (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const controlAsset = await approvedAsset(workspaceId, projectId, marketId);
    const { controlId } = await designateControlIfFirst({ workspaceId, assetId: controlAsset });
    const challengerAsset = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });

    await expect(
      createChallenger({ workspaceId, controlId: controlId!, assetId: controlAsset }),
    ).rejects.toThrow(/cannot challenge itself/);
    const challengerId = await createChallenger({
      workspaceId, controlId: controlId!, assetId: challengerAsset, sourceNote: 'council: weak hook',
    });

    // Lifecycle: queued → live (promote refuses queued).
    await expect(
      promoteChallenger({ workspaceId, challengerId, config: TEST_CONFIG }),
    ).rejects.toThrow(/only live challengers/);
    await setChallengerLive({ workspaceId, challengerId });

    // Below volume → refused (control 5 visitors < 20).
    await seedArm(workspaceId, projectId, controlAsset, 5, 1);
    await seedArm(workspaceId, projectId, challengerAsset, 25, 8);
    await expect(
      promoteChallenger({ workspaceId, challengerId, config: TEST_CONFIG }),
    ).rejects.toThrow(/Below minimum volume/);
    // Control untouched.
    let control = await tenantDb(workspaceId).findFirst(controls, eq(controls.id, controlId!));
    expect(control!.assetId).toBe(controlAsset);

    // Volume up → challenger converts 32% vs control 8% → promote.
    await seedArm(workspaceId, projectId, controlAsset, 20, 1, 'b'); // total 25v / 2s
    expect(await armMetrics(workspaceId, controlAsset)).toEqual({ visitors: 25, conversions: 2 });

    const verdict = await promoteChallenger({ workspaceId, challengerId, config: TEST_CONFIG });
    expect(verdict.promote).toBe(true);

    // The control pointer swapped; the challenger row is WON and retained.
    control = await tenantDb(workspaceId).findFirst(controls, eq(controls.id, controlId!));
    expect(control!.assetId).toBe(challengerAsset);
    const challengerRows = await tenantDb(workspaceId).findMany(challengers, eq(challengers.controlId, controlId!));
    expect(challengerRows).toHaveLength(1);
    expect(challengerRows[0]!.status).toBe('won');

    // Lineage shows designation → creation → promotion, immutable and ordered.
    const lineage = await controlLineage(workspaceId, controlId!);
    expect(lineage.map((l) => l.action)).toEqual(['control.designated', 'challenger.created', 'control.promoted']);
    const promoted = lineage[2]!.meta as { fromAssetId: string; toAssetId: string };
    expect(promoted.fromAssetId).toBe(controlAsset);
    expect(promoted.toAssetId).toBe(challengerAsset);

    // Audit rows are append-only: re-reading returns the same set.
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.targetId, controlId!));
    expect(audits.length).toBe(3);
  });

  it('losing challengers are marked lost and stay in history', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const controlAsset = await approvedAsset(workspaceId, projectId, marketId);
    const { controlId } = await designateControlIfFirst({ workspaceId, assetId: controlAsset });
    const challengerAsset = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
    const challengerId = await createChallenger({ workspaceId, controlId: controlId!, assetId: challengerAsset });
    await setChallengerLive({ workspaceId, challengerId });
    await markChallengerLost({ workspaceId, challengerId, reason: 'control held after 30 days' });

    const rows = await tenantDb(workspaceId).findMany(challengers, eq(challengers.id, challengerId));
    expect(rows[0]!.status).toBe('lost');
    const lineage = await controlLineage(workspaceId, controlId!);
    expect(lineage.map((l) => l.action)).toContain('challenger.lost');
    // The control never moved.
    const control = await tenantDb(workspaceId).findFirst(controls, eq(controls.id, controlId!));
    expect(control!.assetId).toBe(controlAsset);
  });
});
