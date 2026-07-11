import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AssetBlock, type PageBuildPackage } from '@copyforge/core';
import { storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  createAsset,
  getDb,
  insertAssetVersion,
  latestPackage,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  updatePackageRenderings,
  gateReports,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_PACKAGE_JOB, collectUtmVariants, createPackageHandler } from './packageJob.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[packageJob.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const VSL_BLOCKS = (lead: string): AssetBlock[] => [
  { id: `hook-${lead}`, role: 'hook', text: `Hook for ${lead}.`, meta: { timestampStart: 0, timestampEnd: 15 } },
  { id: `lead-${lead}`, role: 'lead', text: `Lead for ${lead}.`, meta: { timestampStart: 15, timestampEnd: 90 } },
  { id: 'offer', role: 'offer', text: 'The kit, installed.', meta: { timestampStart: 90, timestampEnd: 600 } },
  { id: 'cta', role: 'cta', text: 'Book today.', meta: { timestampStart: 600, timestampEnd: 660 } },
];

async function setup(): Promise<{
  workspaceId: string;
  projectId: string;
  marketId: string;
  vslId: string;
}> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-pkg-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Pkg test' });
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
      entry_conversation: 'Is this going to snap?',
    },
  });

  // Target VSL: two lead-variant versions.
  const vslId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  await insertAssetVersion({
    workspaceId, assetId: vslId, blocks: VSL_BLOCKS('story'), createdBy: 'system', meta: { leadType: 'story' },
  });
  await insertAssetVersion({
    workspaceId, assetId: vslId, blocks: VSL_BLOCKS('big_promise'), createdBy: 'system', meta: { leadType: 'big_promise' },
  });

  // Meta ad with block-level message-match tags; YouTube ad with version-level.
  const metaAdId = await createAsset({ workspaceId, projectId, marketId, type: 'meta_ad' });
  await insertAssetVersion({
    workspaceId,
    assetId: metaAdId,
    blocks: [
      { id: 'headline-1', role: 'headline', text: 'Why springs snap early', meta: { adPart: 'headline', angle: 'curiosity', messageMatch: { assetId: vslId, lead: 'story' } } },
      { id: 'primary-1', role: 'body', text: 'The six a.m. bang…', meta: { adPart: 'primary_text', angle: 'fear', messageMatch: { assetId: vslId, lead: 'big_promise' } } },
    ],
    createdBy: 'system',
  });
  const ytId = await createAsset({ workspaceId, projectId, marketId, type: 'youtube_ad' });
  await insertAssetVersion({
    workspaceId,
    assetId: ytId,
    blocks: [
      { id: 'hook', role: 'hook', text: 'Stop.' },
      { id: 'mech', role: 'mechanism', text: 'Cycle fatigue.' },
      { id: 'cta', role: 'cta', text: 'Watch the video.' },
    ],
    createdBy: 'system',
    meta: { angle: 'fear', messageMatch: { assetId: vslId, lead: 'story' } },
  });

  return { workspaceId, projectId, marketId, vslId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_PACKAGE_JOB, payload, attempts: 1, jobRunId: newId() };
}

const latestG7 = async (workspaceId: string, assetId: string) =>
  (await tenantDb(workspaceId).findMany(gateReports, eq(gateReports.assetId, assetId)))
    .filter((g) => g.gate === 'G7')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];

describe('package composer job — G7 (WO-035)', () => {
  it('composes, persists with a stable checksum, and blocks G7 on missing renderings', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const handler = createPackageHandler();

    await handler(makeJob(workspaceId, { projectId, assetId: vslId, marketId }));
    const first = await latestPackage(workspaceId, vslId);
    expect(first).not.toBeNull();
    const pkg = first!.package as unknown as PageBuildPackage;
    expect(pkg.scope.asset_type).toBe('vsl');
    expect(pkg.media.videoobject_schema).not.toBeNull();

    // Message-match variant map from the WO-027 ad tags (block + version level).
    const variants = pkg.message_match.utm_variants;
    expect(variants).toHaveLength(3);
    expect(variants.map((v) => v.utm_content)).toEqual([
      'meta_ad:headline-1',
      'meta_ad:primary-1',
      'youtube_ad:script',
    ]);
    const story = variants.find((v) => v.utm_content === 'meta_ad:headline-1')!;
    expect(story.headline_block).toBe('hook-story');
    expect(story.lead_block).toBe('lead-story');
    const promise = variants.find((v) => v.utm_content === 'meta_ad:primary-1')!;
    expect(promise.headline_block).toBe('hook-big_promise');

    // G7 blocked: renderings missing.
    const g7 = await latestG7(workspaceId, vslId);
    expect(g7!.pass).toBe(false);
    expect((g7!.report as { missing: string[] }).missing).toContain('renderings.macaly_prompt');

    // Checksum stable across identical re-composition (acceptance).
    await handler(makeJob(workspaceId, { projectId, assetId: vslId, marketId }));
    const second = await latestPackage(workspaceId, vslId);
    expect(second!.id).not.toBe(first!.id);
    expect(second!.checksum).toBe(first!.checksum);
  });

  it('renderings persist through recomposition and unblock G7', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const handler = createPackageHandler();
    await handler(makeJob(workspaceId, { projectId, assetId: vslId, marketId }));
    const composed = await latestPackage(workspaceId, vslId);

    await updatePackageRenderings({
      workspaceId,
      packageId: composed!.id,
      renderings: {
        file_paths: ['/exports/vsl.md', '/exports/vsl.txt'],
        macaly_prompt: 'MACALY BUILD PROMPT…',
        universal_llm_prompt: 'UNIVERSAL BUILD PROMPT…',
      },
    });

    // Recompose: renderings carry over, checksum unchanged, G7 passes.
    await handler(makeJob(workspaceId, { projectId, assetId: vslId, marketId }));
    const recomposed = await latestPackage(workspaceId, vslId);
    const pkg = recomposed!.package as unknown as PageBuildPackage;
    expect(pkg.renderings.file_paths).toHaveLength(2);
    expect(recomposed!.checksum).toBe(composed!.checksum);
    const g7 = await latestG7(workspaceId, vslId);
    expect(g7!.pass).toBe(true);
  });

  it('collectUtmVariants returns empty for an asset nothing message-matches', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const lonely = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
    await insertAssetVersion({
      workspaceId,
      assetId: lonely,
      blocks: [
        { id: 'hl', role: 'headline', text: 'x' },
        { id: 'lead', role: 'lead', text: 'y' },
        { id: 'cta', role: 'cta', text: 'z' },
      ],
      createdBy: 'system',
      meta: { structure: 'pas' },
    });
    expect(await collectUtmVariants(workspaceId, marketId, lonely)).toEqual([]);
  });
});
