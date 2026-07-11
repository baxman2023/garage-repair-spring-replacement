import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, readStoreZip, contentChecksum, type AssetBlock } from '@copyforge/core';
import { storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  createAsset,
  getDb,
  insertAssetVersion,
  latestPackage,
  listExportsForAsset,
  listExportsForMarket,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_PACKAGE_JOB, createPackageHandler } from './packageJob.js';
import { exportAssetFiles, exportMarketZip } from './exporter.js';

process.env.EXPORT_DIR = join(tmpdir(), `copyforge-exports-${process.pid}`);

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[exporter.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const LETTER_BLOCKS: AssetBlock[] = [
  { id: 'hl', role: 'headline', text: 'The Six A.M. Snap' },
  { id: 'lead', role: 'lead', text: 'It always happens on the worst morning.' },
  { id: 'offer', role: 'offer', text: 'Everything included, one visit.' },
  { id: 'cta', role: 'cta', text: 'Book the fix today.' },
];
const VSL_BLOCKS: AssetBlock[] = [
  { id: 'hook', role: 'hook', text: 'The bang.', meta: { timestampStart: 0, timestampEnd: 12 } },
  { id: 'offer', role: 'offer', text: 'The kit.', meta: { timestampStart: 12, timestampEnd: 90 } },
  { id: 'cta', role: 'cta', text: 'Book.', meta: { timestampStart: 90, timestampEnd: 150 } },
];

async function setup(): Promise<{
  workspaceId: string;
  projectId: string;
  marketId: string;
  letterId: string;
  vslId: string;
}> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-exp-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Export test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
  });
  const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [{ schema_version: '1', name: 'O' }] });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
  });
  const markets = await listMarkets(workspaceId, projectId);
  const marketId = markets[0]!.id;
  await applyMarketProfile({
    workspaceId,
    projectId,
    marketId,
    profile: {
      schema_version: '1',
      rank: 1,
      label: markets[0]!.label,
      avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
      starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
      awareness_stage: 'problem',
      awareness_justification: 'x',
      sophistication: 2,
      sophistication_justification: 'x',
      resident_emotion: 'dread',
      core_desire: 'forget the door',
      objections: ['a', 'b', 'c', 'd', 'e'],
      voc_corpus_ref: '',
      channels_ranked: ['search'],
      entry_conversation: 'snap?',
    },
  });
  const letterId = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
  await insertAssetVersion({ workspaceId, assetId: letterId, blocks: LETTER_BLOCKS, createdBy: 'system' });
  const vslId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  await insertAssetVersion({ workspaceId, assetId: vslId, blocks: VSL_BLOCKS, createdBy: 'system' });
  return { workspaceId, projectId, marketId, letterId, vslId };
}

const packageJob = (workspaceId: string, payload: Record<string, unknown>): ClaimedJob => ({
  id: newId(), workspaceId, type: ASSET_PACKAGE_JOB, payload, attempts: 1, jobRunId: newId(),
});

describe('export renderer — files (WO-036)', () => {
  it('writes byte-reproducible per-asset files, records history, fills file_paths', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, letterId } = await setup();
    await createPackageHandler()(packageJob(workspaceId, { projectId, assetId: letterId, marketId }));

    const first = await exportAssetFiles({ workspaceId, assetId: letterId });
    expect(first.files.map((f) => f.format)).toEqual(['markdown', 'html']);

    // Byte-reproducible from the same package (acceptance).
    const second = await exportAssetFiles({ workspaceId, assetId: letterId });
    expect(second.files.map((f) => f.checksum)).toEqual(first.files.map((f) => f.checksum));
    for (const f of second.files) {
      expect(contentChecksum(await readFile(f.path, 'utf8'))).toBe(f.checksum);
    }

    // History recorded; package renderings carry the paths.
    const history = await listExportsForAsset(workspaceId, letterId);
    expect(history.length).toBeGreaterThanOrEqual(4); // package job export + two manual runs
    const pkg = (await latestPackage(workspaceId, letterId))!.package as {
      renderings: { file_paths: string[] };
    };
    expect(pkg.renderings.file_paths).toHaveLength(2);
    expect(pkg.renderings.file_paths[0]).toContain(process.env.EXPORT_DIR!);
  });

  it('per-market ZIP contains manifest.json listing checksums (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, letterId, vslId } = await setup();
    const handler = createPackageHandler();
    await handler(packageJob(workspaceId, { projectId, assetId: letterId, marketId }));
    await handler(packageJob(workspaceId, { projectId, assetId: vslId, marketId }));

    const zip = await exportMarketZip({ workspaceId, projectId, marketId });
    expect(zip.fileCount).toBeGreaterThanOrEqual(5); // manifest + 2 letter files + 2 vsl files

    const bytes = new Uint8Array(await readFile(zip.path));
    expect(contentChecksum(bytes)).toBe(zip.checksum);
    const entries = readStoreZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!)) as {
      market: string;
      packages: Array<{ asset: string; checksum: string }>;
      files: Array<{ name: string; checksum: string }>;
    };
    expect(manifest.market).toBe(marketId);
    expect(manifest.packages).toHaveLength(2);
    // Every manifest checksum matches the actual zipped bytes.
    for (const file of manifest.files) {
      const data = entries.get(file.name)!;
      expect(contentChecksum(data)).toBe(file.checksum);
    }

    // ZIP itself is byte-reproducible.
    const again = await exportMarketZip({ workspaceId, projectId, marketId });
    expect(again.checksum).toBe(zip.checksum);

    const history = await listExportsForMarket(workspaceId, marketId);
    expect(history.filter((h) => h.format === 'zip')).toHaveLength(2);
  });
});
