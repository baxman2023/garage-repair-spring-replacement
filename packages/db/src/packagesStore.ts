import { eq } from 'drizzle-orm';
import type { PageBuildPackage } from '@copyforge/core';
import { tenantDb } from './guard.js';
import { pageBuildPackages } from './schema/index.js';

/** Page Build Package persistence (WO-035 / G7). */

export type PackageRow = typeof pageBuildPackages.$inferSelect;

export async function savePackage(params: {
  workspaceId: string;
  projectId: string;
  marketId: string;
  assetId: string;
  pkg: PageBuildPackage;
  checksum: string;
}): Promise<string> {
  return tenantDb(params.workspaceId).insert(pageBuildPackages, {
    projectId: params.projectId,
    marketId: params.marketId,
    assetId: params.assetId,
    schemaVersion: params.pkg.schema_version,
    package: params.pkg as unknown as Record<string, unknown>,
    checksum: params.checksum,
  });
}

export async function latestPackage(
  workspaceId: string,
  assetId: string,
): Promise<PackageRow | null> {
  const rows = await tenantDb(workspaceId).findMany(
    pageBuildPackages,
    eq(pageBuildPackages.assetId, assetId),
  );
  return (
    rows.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    )[0] ?? null
  );
}

/**
 * Fill/replace the renderings on a stored package. Renderings are excluded
 * from the checksum by design, so it stays valid.
 */
export async function updatePackageRenderings(params: {
  workspaceId: string;
  packageId: string;
  renderings: { file_paths: string[]; macaly_prompt: string; universal_llm_prompt: string };
}): Promise<void> {
  const db = tenantDb(params.workspaceId);
  const row = await db.findFirst(pageBuildPackages, eq(pageBuildPackages.id, params.packageId));
  if (!row) throw new Error('Package not found.');
  const pkg = { ...(row.package as Record<string, unknown>), renderings: params.renderings };
  await db.update(pageBuildPackages, { package: pkg }, eq(pageBuildPackages.id, params.packageId));
}
