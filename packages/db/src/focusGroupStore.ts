import { eq } from 'drizzle-orm';
import { tenantDb } from './guard.js';
import { focusGroupRuns } from './schema/index.js';
import { listAssetVersions } from './assetsStore.js';

/** Focus-group run persistence (WO-029 / G4). */

export type FocusGroupRunRow = typeof focusGroupRuns.$inferSelect;

export async function insertFocusGroupRun(params: {
  workspaceId: string;
  assetVersionId: string;
  annotations: Record<string, unknown>;
  pass: boolean;
  report: Record<string, unknown>;
}): Promise<string> {
  return tenantDb(params.workspaceId).insert(focusGroupRuns, {
    assetVersionId: params.assetVersionId,
    annotations: params.annotations,
    pass: params.pass,
    report: params.report,
  });
}

/** Latest run across the asset's versions (newest version, newest run). */
export async function latestFocusGroupRun(
  workspaceId: string,
  assetId: string,
): Promise<(FocusGroupRunRow & { version: number }) | null> {
  const versions = await listAssetVersions(workspaceId, assetId);
  for (const version of [...versions].sort((a, b) => b.version - a.version)) {
    const runs = await tenantDb(workspaceId).findMany(
      focusGroupRuns,
      eq(focusGroupRuns.assetVersionId, version.id),
    );
    if (runs.length > 0) {
      const newest = runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
      return { ...newest, version: version.version };
    }
  }
  return null;
}
