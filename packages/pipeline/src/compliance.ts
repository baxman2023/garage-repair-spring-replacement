import {
  buildClaimsFlagReport,
  evaluateCompliance,
  insertRequiredDisclaimer,
  JOB_TYPES,
  runCompliancePacks,
  type AssetBlock,
  type ComplianceMode,
} from '@copyforge/core';
import {
  getAsset,
  getCurrentAssetVersion,
  getCurrentProfile,
  insertAssetVersion,
  listComplianceAckKeys,
  listCurrentClaims,
  recordAssetGate,
  setAssetStatus,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Compliance pre-flight — gate G6 (WO-032). Fully deterministic: no AI call.
 *
 * Order of operations:
 * 1. Claims inventory check — in strict modes (health/finance) ANY unresolved
 *    flag fails the gate closed. No acknowledgment path exists for this.
 * 2. Required-disclaimer inserter — a strict-mode asset missing its
 *    disclaimer gets it appended as a new locked block/version.
 * 3. Rule packs (FTC + ad policy always; health/finance in mode) — findings
 *    anchor to block ids. Errors block; warnings block unless acknowledged
 *    for THIS version (audited acks).
 *
 * Pass → packaging. Fail → the asset stays in `compliance` with the report;
 * fix flags / acknowledge warnings, then re-run.
 */

export const ASSET_COMPLIANCE_JOB = JOB_TYPES.assetCompliance;

export function createComplianceHandler() {
  return async function handleCompliance(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const assetId = String(job.payload.assetId ?? '');
    if (!projectId || !assetId) throw new Error('asset.compliance job missing projectId/assetId');

    const asset = await getAsset(job.workspaceId, assetId);
    if (!asset) throw new Error('Asset not found.');

    const profileRow = await getCurrentProfile(job.workspaceId, projectId);
    const mode = ((profileRow?.profile as { constraints?: { compliance_mode?: string } } | null)
      ?.constraints?.compliance_mode ?? 'none') as ComplianceMode;

    let version = await getCurrentAssetVersion(job.workspaceId, assetId);
    if (!version) throw new Error('Asset has no current version for compliance.');

    // 1. Claims inventory: strict modes fail closed on unresolved flags.
    const claims = await listCurrentClaims(job.workspaceId, assetId);
    const flagReport = buildClaimsFlagReport(claims.map((c) => ({ text: c.text, status: c.status })));
    if (mode !== 'none' && flagReport.flagged > 0) {
      await recordAssetGate({
        workspaceId: job.workspaceId,
        assetId,
        gate: 'G6',
        pass: false,
        report: {
          mode,
          failClosed: true,
          acknowledgeable: false,
          reason: `${flagReport.flagged} unresolved flagged claim(s) in ${mode} mode`,
          flagReport,
          findings: [],
        },
      });
      return; // stays in `compliance` — resolve flags, then re-run
    }

    // 2. Required-disclaimer inserter.
    let blocks = version.blocks as AssetBlock[];
    const { blocks: withDisclaimer, inserted } = insertRequiredDisclaimer(blocks, mode);
    if (inserted) {
      await insertAssetVersion({
        workspaceId: job.workspaceId,
        assetId,
        blocks: withDisclaimer,
        createdBy: 'system',
        meta: { complianceDisclaimerInserted: mode },
      });
      version = (await getCurrentAssetVersion(job.workspaceId, assetId))!;
      blocks = version.blocks as AssetBlock[];
    }

    // 3. Rule packs + acknowledgments for THIS version.
    const findings = runCompliancePacks(blocks, mode);
    const ackKeys = await listComplianceAckKeys(job.workspaceId, assetId, version.id);
    const verdict = evaluateCompliance(findings, ackKeys);

    await recordAssetGate({
      workspaceId: job.workspaceId,
      assetId,
      gate: 'G6',
      pass: verdict.pass,
      report: {
        mode,
        flagReport,
        disclaimerInserted: inserted,
        versionId: version.id,
        findings,
        errors: verdict.errors,
        unacknowledgedWarnings: verdict.unacknowledgedWarnings,
        acknowledgedWarnings: verdict.acknowledgedWarnings,
        // Only warnings can be acknowledged; errors always block.
        acknowledgeable: verdict.errors.length === 0 && verdict.unacknowledgedWarnings.length > 0,
      } as unknown as Record<string, unknown>,
    });

    if (verdict.pass) {
      await setAssetStatus(job.workspaceId, assetId, 'packaging');
    }
    // On fail the asset stays in `compliance` — acknowledge warnings or fix
    // errors, then re-run G6.
  };
}
