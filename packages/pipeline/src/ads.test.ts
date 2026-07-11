import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AssetBlock } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  createAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  assets as assetsTable,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_GENERATE_JOB, createGenerateHandler } from './generate.js';
import { listLeadTargets } from './generators/ads.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[ads.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_v, i) => `${seed}${'abcdefghijklmnopqrstuvwxyz'[i % 26]}`).join(' ');

async function setup(withTargets = true): Promise<{
  workspaceId: string;
  projectId: string;
  marketId: string;
  vslId: string;
  letterId: string;
}> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-ads-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Ads test' });
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
      awareness_justification: 'daily symptom',
      sophistication: 2,
      sophistication_justification: 'low',
      resident_emotion: 'dread',
      core_desire: 'forget the door',
      objections: ['a', 'b', 'c', 'd', 'e'],
      voc_corpus_ref: '',
      channels_ranked: ['search'],
      entry_conversation: 'Is this going to snap?',
    },
  });

  let vslId = '';
  let letterId = '';
  if (withTargets) {
    // Message-match targets: a VSL with a 'story' lead and a 'pas' letter.
    vslId = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
    await insertAssetVersion({
      workspaceId,
      assetId: vslId,
      blocks: [
        { id: 'a', role: 'hook', text: 'x' },
        { id: 'b', role: 'lead', text: 'y' },
        { id: 'c', role: 'close', text: 'z' },
      ],
      createdBy: 'system',
      meta: { leadType: 'story' },
    });
    letterId = await createAsset({ workspaceId, projectId, marketId, type: 'sales_letter' });
    await insertAssetVersion({
      workspaceId,
      assetId: letterId,
      blocks: [
        { id: 'a', role: 'headline', text: 'x' },
        { id: 'b', role: 'lead', text: 'y' },
        { id: 'c', role: 'close', text: 'z' },
      ],
      createdBy: 'system',
      meta: { structure: 'pas' },
    });
  }
  return { workspaceId, projectId, marketId, vslId, letterId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId() };
}

const piece = (vslId: string, angle: string, n: number) => ({
  text: `Ad piece ${words(n, 'p')}`,
  angle,
  message_match: { asset_id: vslId, lead: 'story' },
});

const metaPayload = (vslId: string, counts = { p: 5, h: 10, d: 5 }) =>
  JSON.stringify({
    primary_texts: Array.from({ length: counts.p }, (_v, i) => piece(vslId, ['fear', 'curiosity', 'proof', 'benefit', 'urgency'][i % 5]!, 40)),
    headlines: Array.from({ length: counts.h }, () => piece(vslId, 'curiosity', 6)),
    descriptions: Array.from({ length: counts.d }, () => piece(vslId, 'benefit', 10)),
  });

describe('lead-target enumeration (WO-027)', () => {
  it('lists VSL lead variants and letter structures for the market', async () => {
    if (!dbUp) return;
    const { workspaceId, marketId, vslId, letterId } = await setup();
    const targets = await listLeadTargets(workspaceId, marketId);
    expect(targets).toContainEqual({ assetId: vslId, assetType: 'vsl', lead: 'story' });
    expect(targets).toContainEqual({ assetId: letterId, assetType: 'sales_letter', lead: 'pas' });
  });
});

describe('Meta ads (WO-027)', () => {
  it('persists 5+10+5 angle-tagged, message-matched pieces', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const mock = new MockTransport();
    mock.pushText(metaPayload(vslId));
    mock.pushText(JSON.stringify({ claims: [] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'meta_ad' }),
    );

    const rows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const asset = rows.find((a) => a.type === 'meta_ad')!;
    const version = (await getCurrentAssetVersion(workspaceId, asset.id))!;
    const blocks = version.blocks as AssetBlock[];
    const byPart = (part: string) => blocks.filter((b) => (b.meta as { adPart?: string }).adPart === part);
    expect(byPart('primary_text')).toHaveLength(5);
    expect(byPart('headline')).toHaveLength(10);
    expect(byPart('description')).toHaveLength(5);
    for (const b of blocks) {
      expect((b.meta as { angle: string }).angle).toBeTruthy(); // angle tags persisted
      expect((b.meta as { messageMatch: { assetId: string; lead: string } }).messageMatch).toEqual({
        assetId: vslId,
        lead: 'story',
      });
    }
    const { jobs } = await import('@copyforge/db');
    const queued = await getDb().select().from(jobs);
    expect(queued.some((j) => j.type === 'asset.council' && (j.payload as { assetId: string }).assetId === asset.id)).toBe(true);
  });

  it('rejects wrong counts and unknown message-match targets', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    let mock = new MockTransport();
    mock.pushText(metaPayload(vslId, { p: 4, h: 10, d: 5 }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'meta_ad' })),
    ).rejects.toThrow();

    mock = new MockTransport();
    const bad = JSON.parse(metaPayload(vslId)) as { headlines: { message_match: { lead: string } }[] };
    bad.headlines[3]!.message_match.lead = 'big_promise'; // lead never persisted for this VSL
    mock.pushText(JSON.stringify(bad));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'meta_ad' })),
    ).rejects.toThrow(/Message-match violation/);
  });

  it('refuses to generate ads when the market has no VSL or letter yet', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup(false);
    const mock = new MockTransport();
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'meta_ad' })),
    ).rejects.toThrow(/VSL or sales letter/);
  });
});

describe('YouTube in-stream (WO-027)', () => {
  const ytPayload = (vslId: string, hookWords: number, bodyWords: number) =>
    JSON.stringify({
      blocks: [
        { id: 'hook', role: 'hook', text: words(hookWords, 'h') },
        { id: 'mech', role: 'mechanism', text: `It costs $349 to ignore. ${words(bodyWords - 20, 'm')}` },
        { id: 'cta', role: 'cta', text: `Watch the full video now. ${words(15, 'c')}` },
      ],
      angle: 'fear',
      message_match: { asset_id: vslId, lead: 'story' },
    });

  it('persists a spoken, timestamped 60-90s script with a ≤5s hook', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const mock = new MockTransport();
    mock.pushText(ytPayload(vslId, 12, 180)); // ≈212 words ≈ 75s
    mock.pushText(JSON.stringify({ claims: [] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'youtube_ad' }),
    );

    const rows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const asset = rows.find((a) => a.type === 'youtube_ad')!;
    const version = (await getCurrentAssetVersion(workspaceId, asset.id))!;
    const blocks = version.blocks as AssetBlock[];
    expect(blocks[0]!.role).toBe('hook');
    expect(blocks[0]!.meta!.timestampEnd as number).toBeLessThanOrEqual(5.1);
    const end = blocks[blocks.length - 1]!.meta!.timestampEnd as number;
    expect(end).toBeGreaterThanOrEqual(57);
    expect(end).toBeLessThanOrEqual(94.5);
    expect(blocks[1]!.text).toContain('three hundred forty-nine dollars'); // spoken conventions
    expect((version.meta as { angle: string }).angle).toBe('fear');
    expect((version.meta as { messageMatch: { lead: string } }).messageMatch.lead).toBe('story');
  });

  it('rejects a slow hook and an out-of-band duration', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    let mock = new MockTransport();
    mock.pushText(ytPayload(vslId, 20, 180)); // 20-word hook ≈ 7s
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'youtube_ad' })),
    ).rejects.toThrow(/5 seconds/);

    mock = new MockTransport();
    mock.pushText(ytPayload(vslId, 10, 25)); // ≈50 words ≈ 18s
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'youtube_ad' })),
    ).rejects.toThrow(/60-90 seconds/);
  });
});

describe('native ads (WO-027)', () => {
  const nativePayload = (vslId: string, n: number) =>
    JSON.stringify({
      pairs: Array.from({ length: n }, (_v, i) => ({
        headline: `Why garage door springs fail early ${i + 1}`,
        teaser: 'A veteran installer explains the part everyone skips.',
        angle: ['curiosity', 'fear', 'proof'][i % 3]!,
        message_match: { asset_id: vslId, lead: 'story' },
      })),
    });

  it('persists 10 headline/teaser pairs with angles', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const mock = new MockTransport();
    mock.pushText(nativePayload(vslId, 10));
    mock.pushText(JSON.stringify({ claims: [] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'native_ad' }),
    );

    const rows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const asset = rows.find((a) => a.type === 'native_ad')!;
    const version = (await getCurrentAssetVersion(workspaceId, asset.id))!;
    const blocks = version.blocks as AssetBlock[];
    expect(blocks).toHaveLength(20);
    for (let i = 1; i <= 10; i++) {
      const pair = blocks.filter((b) => (b.meta as { section?: string }).section === `native_${i}`);
      expect(pair.map((b) => b.role)).toEqual(['headline', 'body']);
      expect((pair[0]!.meta as { angle: string }).angle).toBeTruthy();
    }
    expect((version.meta as { angles: string[] }).angles).toEqual(
      expect.arrayContaining(['curiosity', 'fear', 'proof']),
    );
  });

  it('rejects a set of nine', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const mock = new MockTransport();
    mock.pushText(nativePayload(vslId, 9));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'native_ad' })),
    ).rejects.toThrow();
  });
});

describe('advertorial (WO-027)', () => {
  const advertorialBlocks = (vslId: string) => ({
    blocks: [
      { id: 'hl', role: 'headline', text: 'The morning his garage door would not open' },
      { id: 'story-1', role: 'story', text: `A homeowner we will call Dan heard the bang at 6 a.m. ${words(80, 's')}` },
      { id: 'mech', role: 'mechanism', text: `The real culprit is cycle fatigue. ${words(60, 'm')}` },
      { id: 'proof', role: 'proof', text: words(50, 'p') },
      { id: 'cta', role: 'cta', text: 'See how the fix works in the short video on the next page.' },
      { id: 'disc', role: 'body', text: 'This page is a paid advertisement from SpringGuard.', meta: { section: 'disclosure' } },
    ],
    message_match: { asset_id: vslId, lead: 'story' },
  });

  it('persists a story-led presell with the disclosure block', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(advertorialBlocks(vslId)));
    mock.pushText(JSON.stringify({ claims: [] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'advertorial' }),
    );

    const rows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const asset = rows.find((a) => a.type === 'advertorial')!;
    const version = (await getCurrentAssetVersion(workspaceId, asset.id))!;
    const blocks = version.blocks as AssetBlock[];
    const disclosure = blocks.find(
      (b) => (b.meta as { section?: string } | undefined)?.section === 'disclosure',
    )!;
    expect(disclosure.text).toMatch(/advertisement/i);
    expect((version.meta as { messageMatch: { assetId: string } }).messageMatch.assetId).toBe(vslId);
  });

  it('rejects a missing disclosure and a non-story lead', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, vslId } = await setup();
    let mock = new MockTransport();
    const noDisclosure = advertorialBlocks(vslId);
    noDisclosure.blocks = noDisclosure.blocks.filter((b) => b.id !== 'disc');
    mock.pushText(JSON.stringify(noDisclosure));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'advertorial' })),
    ).rejects.toThrow(/disclosure/);

    mock = new MockTransport();
    const mechanismFirst = advertorialBlocks(vslId);
    const story = mechanismFirst.blocks.splice(1, 1)[0]!;
    mechanismFirst.blocks.splice(2, 0, story); // mechanism now precedes story
    mock.pushText(JSON.stringify(mechanismFirst));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'advertorial' })),
    ).rejects.toThrow(/story-led/);
  });
});
