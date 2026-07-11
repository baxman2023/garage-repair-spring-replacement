import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, SEQUENCE_KINDS, type AssetBlock, type SequenceKind } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  getCurrentAssetVersion,
  getDb,
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

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[emailSequences.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const email = (id: string, offset: number, phase?: string) => ({
  id,
  subject: `Note ${id.replace(/[^a-z]/g, '')} about the door`,
  preview: 'The part the installer skips.',
  body: `It snapped at six in the morning. The {{product_name}} fix is here: {{cta_link}}\n\n{{founder_name}}`,
  send_offset_hours: offset,
  ...(phase ? { phase } : {}),
});

const KIND_EMAILS: Record<SequenceKind, unknown[]> = {
  welcome: Array.from({ length: 6 }, (_v, i) => email(`w-${i + 1}`, i * 24)),
  launch: Array.from({ length: 9 }, (_v, i) =>
    email(`l-${i + 1}`, i * 24, ['seed', 'open', 'close'][Math.floor(i / 3)]),
  ),
  cart_abandon: [email('ca-1', 1), email('ca-2', 24), email('ca-3', 48)],
  daily_infotainment: Array.from({ length: 10 }, (_v, i) => email(`d-${i + 1}`, (i + 1) * 24)),
};

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-seq-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Email seq test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: {
      schema_version: '1',
      name: 'SpringGuard',
      category: 'garage-repair',
      founder_voice_samples: ['I fixed doors for twenty years. Springs lie to you.'],
    },
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
  return { workspaceId, projectId, marketId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId() };
}

describe('email-sequence generator (WO-026)', () => {
  it('persists all four sequences with graphs, offsets, and subject/preview/body triplets', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    for (const kind of SEQUENCE_KINDS) {
      mock.pushText(JSON.stringify({ emails: KIND_EMAILS[kind] }));
      mock.pushText(JSON.stringify({ claims: [] }));
    }

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'email_sequence' }),
    );

    const rows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const sequences = rows.filter((a) => a.type === 'email_sequence');
    expect(sequences).toHaveLength(4);

    const byKind = new Map<string, (typeof sequences)[number]>();
    for (const asset of sequences) {
      const version = (await getCurrentAssetVersion(workspaceId, asset.id))!;
      const graph = (version.meta as { sequence: { kind: string; emails: { id: string; send_offset_hours: number }[] } }).sequence;
      byKind.set(graph.kind, asset);

      // Sequence graph: send offsets persisted, strictly increasing.
      const offsets = graph.emails.map((e) => e.send_offset_hours);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
      expect(new Set(offsets).size).toBe(offsets.length);

      // Blocks: subject/preview/body triplet per email, sectioned, offset in meta.
      const blocks = version.blocks as AssetBlock[];
      expect(blocks).toHaveLength(graph.emails.length * 3);
      for (const entry of graph.emails) {
        const triplet = blocks.filter((b) => (b.meta as { section?: string }).section === entry.id);
        expect(triplet.map((b) => b.role)).toEqual(['subject', 'preview', 'body']);
        expect((triplet[0]!.meta as { sendOffsetHours: number }).sendOffsetHours).toBe(entry.send_offset_hours);
      }
    }
    expect(new Set(byKind.keys())).toEqual(new Set(SEQUENCE_KINDS));

    // Cardinality per spec: 6 welcome (5-7 band), 9 launch, 3 abandon, 10 daily.
    const count = async (kind: string) => {
      const v = (await getCurrentAssetVersion(workspaceId, byKind.get(kind)!.id))!;
      return (v.meta as { sequence: { emails: unknown[] } }).sequence.emails.length;
    };
    expect(await count('welcome')).toBe(6);
    expect(await count('launch')).toBe(9);
    expect(await count('cart_abandon')).toBe(3);
    expect(await count('daily_infotainment')).toBe(10);

    // Launch graph keeps phase tags; every sequence auto-enters G3.
    const launchVersion = (await getCurrentAssetVersion(workspaceId, byKind.get('launch')!.id))!;
    const launchGraph = (launchVersion.meta as { sequence: { emails: { phase?: string }[] } }).sequence;
    expect(launchGraph.emails.map((e) => e.phase)).toEqual([
      'seed', 'seed', 'seed', 'open', 'open', 'open', 'close', 'close', 'close',
    ]);
    const { jobs } = await import('@copyforge/db');
    const queued = await getDb().select().from(jobs);
    const councilJobs = queued.filter(
      (j) => j.type === 'asset.council' && sequences.some((a) => a.id === (j.payload as { assetId: string }).assetId),
    );
    expect(councilJobs).toHaveLength(4);

    // Founder voice samples reached the daily-infotainment prompt.
    const dailyCall = mock.calls.find((c) => c.req.messages[0]!.content.toString().includes('daily_infotainment'));
    expect(dailyCall!.req.messages[0]!.content).toContain('Springs lie to you');
  });

  it('rejects an AI-tell subject (G5 scrub at generation time)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const bad = (KIND_EMAILS.welcome as ReturnType<typeof email>[]).map((e) => ({ ...e }));
    bad[0] = { ...bad[0]!, subject: 'Unlock the secret to a quiet door' };
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ emails: bad }));
    await expect(
      createGenerateHandler({ transport: mock })(
        makeJob(workspaceId, { projectId, marketId, assetType: 'email_sequence', options: { sequences: ['welcome'] } }),
      ),
    ).rejects.toThrow(/AI-tell/);
  });

  it('rejects a body that breaks the single-CTA rule', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const bad = (KIND_EMAILS.cart_abandon as ReturnType<typeof email>[]).map((e) => ({ ...e }));
    bad[1] = { ...bad[1]!, body: 'Two ways in: {{cta_link}} and {{cta_link}}' };
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ emails: bad }));
    await expect(
      createGenerateHandler({ transport: mock })(
        makeJob(workspaceId, { projectId, marketId, assetType: 'email_sequence', options: { sequences: ['cart_abandon'] } }),
      ),
    ).rejects.toThrow(/exactly one \{\{cta_link\}\}/);
  });

  it('rejects undocumented merge fields and wrong cardinality', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    let mock = new MockTransport();
    const badField = (KIND_EMAILS.cart_abandon as ReturnType<typeof email>[]).map((e) => ({ ...e }));
    badField[0] = { ...badField[0]!, body: 'Use {{coupon_code}} here: {{cta_link}}' };
    mock.pushText(JSON.stringify({ emails: badField }));
    await expect(
      createGenerateHandler({ transport: mock })(
        makeJob(workspaceId, { projectId, marketId, assetType: 'email_sequence', options: { sequences: ['cart_abandon'] } }),
      ),
    ).rejects.toThrow(/undocumented merge fields/);

    mock = new MockTransport();
    mock.pushText(JSON.stringify({ emails: (KIND_EMAILS.daily_infotainment as unknown[]).slice(0, 9) }));
    await expect(
      createGenerateHandler({ transport: mock })(
        makeJob(workspaceId, { projectId, marketId, assetType: 'email_sequence', options: { sequences: ['daily_infotainment'] } }),
      ),
    ).rejects.toThrow(/exactly 10/);
  });
});
