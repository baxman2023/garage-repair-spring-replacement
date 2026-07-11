import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  attachClaimProof,
  auditLog,
  claimsFlagReport,
  closePool,
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  insertClaims,
  listClaims,
  listCurrentClaims,
  projects,
  resetClaimToFlagged,
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
    mock.pushText(JSON.stringify({ claims: [] })); // WO-031 re-extraction
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

describe('claims inventory — proof linker + regeneration survival (WO-031)', () => {
  it('attached proofs survive regeneration via text-similarity rematch (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, assetId } = await setup(false);
    const v1 = await getCurrentAssetVersion(workspaceId, assetId);
    await insertClaims({
      workspaceId,
      assetId,
      assetVersionId: v1!.id,
      claims: [{ text: 'rated ten thousand cycles by the independent lab' }],
    });
    const [claim] = await listClaims(workspaceId, assetId);
    expect(claim!.status).toBe('flagged'); // extraction without proof arrives flagged
    await attachClaimProof({ workspaceId, claimId: claim!.id, proofRef: 'lab-cert-2201' });

    // Regenerate: the model re-emits a PARAPHRASE of the proven claim plus a new one.
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ text: 'New headline text' }));
    mock.pushText(
      JSON.stringify({
        claims: [
          { text: 'rated ten thousand cycles by an accredited independent lab', proof_ref: '' },
          { text: 'saves five hundred dollars every single year', proof_ref: '' },
        ],
      }),
    );
    await createRegenBlockHandler({ transport: mock })(
      makeJob(workspaceId, { assetId, blockId: 'headline' }),
    );

    const current = await listCurrentClaims(workspaceId, assetId);
    expect(current).toHaveLength(2);
    const survived = current.find((c) => c.text.includes('accredited'))!;
    expect(survived.status).toBe('proven'); // resolution carried by similarity
    expect(survived.proofRef).toBe('lab-cert-2201');
    const fresh = current.find((c) => c.text.includes('five hundred'))!;
    expect(fresh.status).toBe('flagged');

    // Flag report reflects the CURRENT version's claims.
    const report = await claimsFlagReport(workspaceId, assetId);
    expect(report).toMatchObject({ total: 2, proven: 1, flagged: 1 });
    expect(report.flaggedClaims[0]).toContain('five hundred');

    // Proof linker roundtrip: attach → proven, detach → flagged.
    await attachClaimProof({ workspaceId, claimId: fresh.id, proofRef: 'case-study-9' });
    expect((await claimsFlagReport(workspaceId, assetId)).flagged).toBe(0);
    await resetClaimToFlagged({ workspaceId, claimId: fresh.id });
    expect((await claimsFlagReport(workspaceId, assetId)).flagged).toBe(1);
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
