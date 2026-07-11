import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, complianceFindingKey, type AssetBlock, type ComplianceFinding } from '@copyforge/core';
import { storeWorkspaceKey } from '@copyforge/ai';
import {
  attachClaimProof,
  auditLog,
  closePool,
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  insertClaims,
  listAssetVersions,
  listClaims,
  projects,
  recordComplianceAck,
  saveProfileVersion,
  setAssetStatus,
  tenantDb,
  gateReports,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_COMPLIANCE_JOB, createComplianceHandler } from './compliance.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[compliance.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(params: {
  complianceMode: 'none' | 'health' | 'finance';
  blocks: AssetBlock[];
  claims?: Array<{ text: string; proofRef?: string }>;
}): Promise<{ workspaceId: string; projectId: string; assetId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-g6-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'G6 test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: {
      schema_version: '1',
      name: 'SpringGuard',
      category: 'garage-repair',
      constraints: { compliance_mode: params.complianceMode, banned_claims: [] },
    },
  });
  const assetId = await createAsset({ workspaceId, projectId, type: 'sales_letter' });
  const version = await insertAssetVersion({ workspaceId, assetId, blocks: params.blocks, createdBy: 'system' });
  if (params.claims?.length) {
    await insertClaims({ workspaceId, assetId, assetVersionId: version.id, claims: params.claims });
  }
  // Walk to where a G5 pass leaves the asset.
  await setAssetStatus(workspaceId, assetId, 'council');
  await setAssetStatus(workspaceId, assetId, 'focus_group');
  await setAssetStatus(workspaceId, assetId, 'deslop');
  await setAssetStatus(workspaceId, assetId, 'compliance');
  return { workspaceId, projectId, assetId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_COMPLIANCE_JOB, payload, attempts: 1, jobRunId: newId() };
}

const latestG6 = async (workspaceId: string, assetId: string) =>
  (await tenantDb(workspaceId).findMany(gateReports, eq(gateReports.assetId, assetId)))
    .filter((g) => g.gate === 'G6')
    // ULID tiebreak: two runs can land in the same second.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];

describe('compliance pre-flight — G6 (WO-032)', () => {
  it('strict mode fails CLOSED on unresolved flagged claims — no acknowledgment path', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup({
      complianceMode: 'health',
      blocks: [{ id: 'lead', role: 'lead', text: 'A calm, factual sentence about garage doors.' }],
      claims: [{ text: 'rated ten thousand cycles' }], // flagged (no proof)
    });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));

    const report = await latestG6(workspaceId, assetId);
    expect(report!.pass).toBe(false);
    const detail = report!.report as { failClosed: boolean; acknowledgeable: boolean; reason: string };
    expect(detail.failClosed).toBe(true);
    expect(detail.acknowledgeable).toBe(false);
    expect(detail.reason).toMatch(/1 unresolved flagged claim/);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('compliance'); // fix + re-run

    // Resolve the flag → re-run passes (clean copy, no findings).
    const [claim] = await listClaims(workspaceId, assetId);
    await attachClaimProof({ workspaceId, claimId: claim!.id, proofRef: 'lab-cert' });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));
    expect((await latestG6(workspaceId, assetId))!.pass).toBe(true);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('packaging');
  });

  it('lint warnings block until acknowledged with an audited reason; then pass', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup({
      complianceMode: 'none',
      blocks: [
        { id: 'hook', role: 'hook', text: 'The shocking truth doctors hate about garage doors.' },
        { id: 'body', role: 'body', text: 'See the before and after photos from real installs.' },
      ],
    });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));

    let report = await latestG6(workspaceId, assetId);
    expect(report!.pass).toBe(false);
    const detail = report!.report as { unacknowledgedWarnings: ComplianceFinding[]; acknowledgeable: boolean };
    expect(detail.acknowledgeable).toBe(true);
    expect(detail.unacknowledgedWarnings.length).toBeGreaterThanOrEqual(2);
    expect(detail.unacknowledgedWarnings.map((f) => f.blockId)).toEqual(
      expect.arrayContaining(['hook', 'body']),
    );

    // Acknowledge with audit, re-run → pass.
    const version = await getCurrentAssetVersion(workspaceId, assetId);
    const userId = newId();
    await recordComplianceAck({
      workspaceId,
      assetId,
      assetVersionId: version!.id,
      actorUserId: userId,
      reason: 'pre-approved creative for retargeting audience',
      findingKeys: detail.unacknowledgedWarnings.map((f) => complianceFindingKey(f)),
    });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));

    report = await latestG6(workspaceId, assetId);
    expect(report!.pass).toBe(true);
    const passDetail = report!.report as unknown as { acknowledgedWarnings: ComplianceFinding[] };
    expect(passDetail.acknowledgedWarnings.length).toBeGreaterThanOrEqual(2);
    expect((await getAsset(workspaceId, assetId))!.status).toBe('packaging');

    // The acknowledgment is on the audit record with the actor and reason.
    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, assetId));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('compliance.acknowledge');
    expect(audits[0]!.actorUserId).toBe(userId);
    expect((audits[0]!.meta as { reason: string }).reason).toContain('retargeting');
  });

  it('errors are never acknowledgeable', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup({
      complianceMode: 'none',
      blocks: [{ id: 'offer', role: 'offer', text: 'Guaranteed results in thirty days.' }],
    });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));
    const report = await latestG6(workspaceId, assetId);
    expect(report!.pass).toBe(false);
    const detail = report!.report as { errors: ComplianceFinding[]; acknowledgeable: boolean };
    expect(detail.errors[0]!.ruleId).toBe('ftc.guaranteed_outcome');
    expect(detail.acknowledgeable).toBe(false);

    // Even acknowledging the error's key changes nothing.
    const version = await getCurrentAssetVersion(workspaceId, assetId);
    await recordComplianceAck({
      workspaceId,
      assetId,
      assetVersionId: version!.id,
      actorUserId: null,
      reason: 'attempting to bypass',
      findingKeys: detail.errors.map((f) => complianceFindingKey(f)),
    });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));
    expect((await latestG6(workspaceId, assetId))!.pass).toBe(false);
  });

  it('finance mode auto-inserts the required disclaimer, which satisfies the earnings rule', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup({
      complianceMode: 'finance',
      blocks: [{ id: 'lead', role: 'lead', text: 'Our students earn $2,000 per month with this system.' }],
    });
    await createComplianceHandler()(makeJob(workspaceId, { projectId, assetId }));

    const report = await latestG6(workspaceId, assetId);
    const detail = report!.report as { disclaimerInserted: boolean };
    expect(detail.disclaimerInserted).toBe(true);
    expect(report!.pass).toBe(true); // the inserted disclaimer satisfies the earnings rule

    const versions = await listAssetVersions(workspaceId, assetId);
    expect(versions).toHaveLength(2);
    const current = await getCurrentAssetVersion(workspaceId, assetId);
    const disclaimer = (current!.blocks as AssetBlock[]).find(
      (b) => (b.meta as { section?: string } | undefined)?.section === 'disclaimer',
    );
    expect(disclaimer!.text).toContain('Results may vary');
    expect((disclaimer!.meta as { locked: boolean }).locked).toBe(true);
  });
});
