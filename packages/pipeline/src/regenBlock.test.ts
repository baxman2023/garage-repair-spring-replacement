import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  auditLog,
  closePool,
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  projects,
  tenantDb,
  transitionAssetStatus,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_REGEN_BLOCK_JOB, createRegenBlockHandler } from './regenBlock.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[regenBlock.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_REGEN_BLOCK_JOB, payload, attempts: 1, jobRunId: newId() };
}

async function setup(locked: boolean): Promise<{ workspaceId: string; assetId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-regen-test-00000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Regen test' });
  const assetId = await createAsset({ workspaceId, projectId, type: 'sales_letter' });
  await insertAssetVersion({
    workspaceId,
    assetId,
    blocks: [
      { id: 'headline', role: 'headline', text: 'Old headline', meta: locked ? { locked: true } : undefined },
      { id: 'lead', role: 'lead', text: 'Untouched lead' },
    ],
    createdBy: 'system',
  });
  return { workspaceId, assetId };
}

describe('regenerate-single-block (WO-021)', () => {
  it('creates a new version changing exactly the target block', async () => {
    if (!dbUp) return;
    const { workspaceId, assetId } = await setup(false);
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ text: 'The Six A.M. Snap That Traps Your Car' }));
    await createRegenBlockHandler({ transport: mock })(
      makeJob(workspaceId, { assetId, blockId: 'headline', instruction: 'more visceral' }),
    );

    const version = await getCurrentAssetVersion(workspaceId, assetId);
    expect(version!.version).toBe(2);
    const blocks = version!.blocks as { id: string; text: string }[];
    expect(blocks.find((b) => b.id === 'headline')!.text).toBe('The Six A.M. Snap That Traps Your Car');
    expect(blocks.find((b) => b.id === 'lead')!.text).toBe('Untouched lead');
    expect(mock.calls[0].req.messages[0].content).toContain('more visceral');
  });

  it('refuses to regenerate a locked block', async () => {
    if (!dbUp) return;
    const { workspaceId, assetId } = await setup(true);
    const mock = new MockTransport();
    await expect(
      createRegenBlockHandler({ transport: mock })(makeJob(workspaceId, { assetId, blockId: 'headline' })),
    ).rejects.toThrow(/locked/);
    expect(mock.calls.length).toBe(0);
    expect((await getCurrentAssetVersion(workspaceId, assetId))!.version).toBe(1);
  });
});

describe('enforced transitions (WO-021)', () => {
  it('rejects illegal moves and audits overrides', async () => {
    if (!dbUp) return;
    const { workspaceId, assetId } = await setup(false);
    await expect(
      transitionAssetStatus({ workspaceId, assetId, to: 'approved' }),
    ).rejects.toThrow(/Illegal/); // draft → approved

    await transitionAssetStatus({ workspaceId, assetId, to: 'council' });
    await transitionAssetStatus({ workspaceId, assetId, to: 'blocked' });
    // blocked without override is trapped.
    await expect(transitionAssetStatus({ workspaceId, assetId, to: 'council' })).rejects.toThrow();
    // Owner override resumes and is audited.
    const userId = newId();
    await transitionAssetStatus({
      workspaceId,
      assetId,
      to: 'council',
      override: true,
      actorUserId: userId,
      reason: 'reviewed manually',
    });
    expect((await getAsset(workspaceId, assetId))!.status).toBe('council');

    const audits = await getDb().select().from(auditLog).where(eq(auditLog.targetId, assetId));
    expect(audits.length).toBe(1);
    expect(audits[0]!.action).toBe('asset.status_override');
    expect(audits[0]!.actorUserId).toBe(userId);
    expect((audits[0]!.meta as { reason: string }).reason).toBe('reviewed manually');
  });
});
