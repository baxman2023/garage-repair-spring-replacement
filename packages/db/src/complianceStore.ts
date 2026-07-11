import { and, eq } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { auditLog } from './schema/index.js';

/**
 * Compliance acknowledgments (WO-032): the acknowledge-with-audit path for
 * ad-policy lint WARNINGS. Each acknowledgment is an audit_log row scoped to
 * an asset VERSION — a new version's findings must be re-acknowledged. Error
 * findings and strict-mode claim failures have no acknowledgment path.
 */

export const COMPLIANCE_ACK_ACTION = 'compliance.acknowledge';

export async function recordComplianceAck(params: {
  workspaceId: string;
  assetId: string;
  assetVersionId: string;
  actorUserId: string | null;
  reason: string;
  /** `${ruleId}:${blockId}` keys being acknowledged. */
  findingKeys: string[];
}): Promise<string> {
  if (!params.reason.trim()) throw new Error('An acknowledgment reason is required (audited).');
  if (params.findingKeys.length === 0) throw new Error('Nothing to acknowledge.');
  const id = newId();
  await getDb().insert(auditLog).values({
    id,
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    action: COMPLIANCE_ACK_ACTION,
    targetType: 'asset',
    targetId: params.assetId,
    meta: {
      assetVersionId: params.assetVersionId,
      findingKeys: params.findingKeys,
      reason: params.reason.trim(),
    },
  });
  return id;
}

/** All acknowledged finding keys for one asset version. */
export async function listComplianceAckKeys(
  workspaceId: string,
  assetId: string,
  assetVersionId: string,
): Promise<Set<string>> {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, workspaceId),
        eq(auditLog.action, COMPLIANCE_ACK_ACTION),
        eq(auditLog.targetId, assetId),
      ),
    );
  const keys = new Set<string>();
  for (const row of rows) {
    const meta = (row.meta ?? {}) as { assetVersionId?: string; findingKeys?: string[] };
    if (meta.assetVersionId !== assetVersionId) continue;
    for (const k of meta.findingKeys ?? []) keys.add(k);
  }
  return keys;
}
