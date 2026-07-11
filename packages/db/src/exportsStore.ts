import { eq } from 'drizzle-orm';
import { tenantDb } from './guard.js';
import { exports as exportsTable } from './schema/index.js';

/** Export history (WO-036). */

export type ExportRow = typeof exportsTable.$inferSelect;

export async function recordExport(params: {
  workspaceId: string;
  packageId?: string | null;
  assetId?: string | null;
  marketId?: string | null;
  format: 'markdown' | 'html' | 'txt' | 'zip' | 'json';
  path: string;
  checksum: string;
  manifest?: Record<string, unknown> | null;
}): Promise<string> {
  return tenantDb(params.workspaceId).insert(exportsTable, {
    packageId: params.packageId ?? null,
    assetId: params.assetId ?? null,
    marketId: params.marketId ?? null,
    format: params.format,
    path: params.path,
    checksum: params.checksum,
    manifest: params.manifest ?? null,
  });
}

export async function listExportsForAsset(workspaceId: string, assetId: string): Promise<ExportRow[]> {
  const rows = await tenantDb(workspaceId).findMany(exportsTable, eq(exportsTable.assetId, assetId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}

export async function listExportsForMarket(workspaceId: string, marketId: string): Promise<ExportRow[]> {
  const rows = await tenantDb(workspaceId).findMany(exportsTable, eq(exportsTable.marketId, marketId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}
