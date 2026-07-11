import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  contentChecksum,
  parsePageBuildPackage,
  renderAssetFiles,
  zipStore,
  type PageBuildPackage,
  type ZipEntry,
} from '@copyforge/core';
import {
  assets as assetsTable,
  latestPackage,
  recordExport,
  tenantDb,
  updatePackageRenderings,
} from '@copyforge/db';
import { eq } from 'drizzle-orm';

/**
 * Export writer (WO-036): renders a package's file artifacts to disk
 * (byte-reproducible — the renderers are pure), records export history, and
 * fills the package's renderings.file_paths. The per-market ZIP bundles every
 * asset's files with a manifest.json listing checksums (acceptance).
 */

export function exportRoot(): string {
  return resolve(process.env.EXPORT_DIR ?? './exports');
}

export interface ExportedFile {
  path: string;
  checksum: string;
  format: 'markdown' | 'html' | 'txt';
}

/** Render + write one asset's files from its latest package. */
export async function exportAssetFiles(params: {
  workspaceId: string;
  assetId: string;
}): Promise<{ packageId: string; files: ExportedFile[] }> {
  const row = await latestPackage(params.workspaceId, params.assetId);
  if (!row) throw new Error('No package to export — run the composer (G7) first.');
  const pkg = parsePageBuildPackage(row.package);

  const dir = join(exportRoot(), params.workspaceId, pkg.scope.market);
  const files: ExportedFile[] = [];
  for (const file of renderAssetFiles(pkg)) {
    const path = join(dir, file.filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, 'utf8');
    const checksum = contentChecksum(file.content);
    files.push({ path, checksum, format: file.format });
    await recordExport({
      workspaceId: params.workspaceId,
      packageId: row.id,
      assetId: params.assetId,
      marketId: pkg.scope.market,
      format: file.format,
      path,
      checksum,
    });
  }

  await updatePackageRenderings({
    workspaceId: params.workspaceId,
    packageId: row.id,
    renderings: {
      ...pkg.renderings,
      file_paths: files.map((f) => f.path),
    },
  });
  return { packageId: row.id, files };
}

/**
 * Per-market ZIP: every packaged asset's rendered files + manifest.json with
 * per-file checksums and the source package checksums.
 */
export async function exportMarketZip(params: {
  workspaceId: string;
  projectId: string;
  marketId: string;
}): Promise<{ path: string; checksum: string; fileCount: number }> {
  const assets = await tenantDb(params.workspaceId).findMany(
    assetsTable,
    eq(assetsTable.marketId, params.marketId),
  );

  const entries: ZipEntry[] = [];
  const manifestFiles: Array<{ name: string; checksum: string; asset: string; format: string }> = [];
  const packages: Array<{ asset: string; asset_type: string; checksum: string }> = [];

  for (const asset of assets.sort((a, b) => a.id.localeCompare(b.id))) {
    const row = await latestPackage(params.workspaceId, asset.id);
    if (!row) continue;
    const pkg: PageBuildPackage = parsePageBuildPackage(row.package);
    packages.push({ asset: asset.id, asset_type: pkg.scope.asset_type, checksum: row.checksum });
    for (const file of renderAssetFiles(pkg)) {
      entries.push({ name: file.filename, content: file.content });
      manifestFiles.push({
        name: file.filename,
        checksum: contentChecksum(file.content),
        asset: asset.id,
        format: file.format,
      });
    }
  }
  if (entries.length === 0) throw new Error('No packaged assets in this market to zip.');

  const manifest = {
    schema_version: '1',
    project: params.projectId,
    market: params.marketId,
    packages,
    files: manifestFiles,
  };
  entries.unshift({ name: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` });

  const zip = zipStore(entries);
  const path = join(exportRoot(), params.workspaceId, `market-${params.marketId.slice(-8).toLowerCase()}.zip`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, zip);
  const checksum = contentChecksum(zip);
  await recordExport({
    workspaceId: params.workspaceId,
    marketId: params.marketId,
    format: 'zip',
    path,
    checksum,
    manifest,
  });
  return { path, checksum, fileCount: entries.length };
}
