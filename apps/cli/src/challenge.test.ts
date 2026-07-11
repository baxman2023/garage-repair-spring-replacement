import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AssetBlock } from '@copyforge/core';

process.env.EXPORT_DIR = join(tmpdir(), `copyforge-exports-cli-ch-${process.pid}`);
import { storeWorkspaceKey, type Transport } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  buildStrategySnapshot,
  closePool,
  createAsset,
  getDb,
  insertAssetVersion,
  listMarkets,
  recordEvent,
  recordFunnelMathRun,
  recordG0,
  recordG2,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  challengers as challengersTable,
  controls as controlsTable,
  projects,
} from '@copyforge/db';
import { parseTarget, runChallengePhase } from './challenge.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[cli challenge.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

// G5-calibrated copy (grade in band, zero tells, specifics, varied rhythm).
const CONTROL_BLOCKS: AssetBlock[] = [
  { id: 'hl', role: 'headline', text: 'Your order is complete, and your SpringGuard installation is officially scheduled.' },
  { id: 'lead', role: 'lead', text: 'One decision remains before you go. The Torsion Tune-Up Guide shows the maintenance routine our installers perform on their own garage doors, and it typically extends a replacement spring by several additional seasons. It normally sells separately, and today it is bundled into this order alone.' },
  { id: 'offer', role: 'offer', text: 'Add it once. Keep it forever.' },
  { id: 'cta', role: 'cta', text: 'Add the Torsion Tune-Up Guide to my order' },
  { id: 'decline', role: 'body', text: 'No thanks, take me to my order', meta: { section: 'decline' } },
];
const CHALLENGER_BLOCKS = [
  { id: 'hl', role: 'headline', text: 'Your installation date is locked, and one upgrade window closes when you leave this page.' },
  { id: 'lead', role: 'lead', text: 'Here is the part nobody mentions at checkout. The Torsion Tune-Up Guide documents the fifteen-minute seasonal routine our own installers run at home, and doors on that routine keep their replacement springs working for several extra winters. It is bundled into this order today and sold separately after.' },
  { id: 'offer', role: 'offer', text: 'One click now. Quieter mornings for years.' },
  { id: 'cta', role: 'cta', text: 'Add the Torsion Tune-Up Guide to my order' },
  { id: 'decline', role: 'body', text: 'No thanks, take me to my order', meta: { section: 'decline' } },
];

const LENS_PASS = JSON.stringify({ score: 88, verdict: 'pass', top_fixes: [], line_notes: [] });

/** Content-routed transport: challenger draft + the full gate cascade, zero tokens. */
function challengeTransport() {
  const calls: string[] = [];
  const transport: Transport = {
    async createMessage(req) {
      const system = (req.system ?? []).map((b) => b.text).join('\n');
      const user = req.messages[0]?.content ?? '';
      let text: string;
      if (user.includes('CHALLENGER BRIEF')) {
        calls.push('challenger');
        text = JSON.stringify({ blocks: CHALLENGER_BLOCKS });
      } else if (user.includes('LENS FOR THIS CALL')) {
        calls.push('lens');
        text = LENS_PASS;
      } else if (system.includes('simulate COLD-TRAFFIC')) {
        calls.push('focus');
        const personasJson = user.split('CLAIMS INVENTORY')[0]!;
        const personas = JSON.parse(personasJson.slice(personasJson.indexOf('['))) as { id: string }[];
        text = JSON.stringify({
          results: personas.map((p) => ({
            persona_id: p.id,
            reached_cta: true,
            attention_drop_block: null,
            disbelief_claims: [],
            bounce_reason: '',
            spouse_test_quote: 'Sounds practical to me.',
          })),
        });
      } else if (system.includes('extract every factual CLAIM')) {
        calls.push('claims');
        text = JSON.stringify({ claims: [] });
      } else {
        throw new Error(`challengeTransport: unroutable request: ${user.slice(0, 120)}`);
      }
      return {
        model: req.model,
        text,
        stopReason: 'end_turn',
        usage: { inputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 5 },
      };
    },
  };
  return { transport, calls };
}

/** Fixture: G0–G2 project + two live controls with a ledger (weak vs strong). */
async function fixtureLedger() {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-cli-chal-00000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'CLI challenge fixture' });
  await saveProfileVersion({
    workspaceId, projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
  });
  const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [{ schema_version: '1', name: 'O' }] });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await recordFunnelMathRun({ workspaceId, projectId, inputs: {}, outputs: {}, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId, projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
  });
  for (const m of await listMarkets(workspaceId, projectId)) {
    await applyMarketProfile({
      workspaceId, projectId, marketId: m.id,
      profile: {
        schema_version: '1', rank: m.rank, label: m.label,
        avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
        starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
        awareness_stage: 'problem', awareness_justification: 'daily symptom',
        sophistication: 2, sophistication_justification: 'low',
        resident_emotion: 'dread', core_desire: 'forget the door',
        objections: ['a', 'b', 'c', 'd', 'e'], voc_corpus_ref: '',
        channels_ranked: ['search'], entry_conversation: 'Is this going to snap?',
      },
    });
  }
  await recordG2({ workspaceId, projectId, snapshot: await buildStrategySnapshot(workspaceId, projectId) });

  const markets = await listMarkets(workspaceId, projectId);
  const m1 = markets.find((m) => m.rank === 1)!.id;
  const m2 = markets.find((m) => m.rank === 2)!.id;

  const makeControl = async (marketId: string) => {
    const assetId = await createAsset({ workspaceId, projectId, marketId, type: 'upsell' });
    await insertAssetVersion({ workspaceId, assetId, blocks: CONTROL_BLOCKS, createdBy: 'system' });
    const controlId = await tenantDb(workspaceId).insert(controlsTable, {
      projectId, marketId, assetType: 'upsell', assetId,
    });
    return { assetId, controlId };
  };
  const weak = await makeControl(m1);
  const strong = await makeControl(m2);

  const seedArm = async (assetId: string, views: number, sales: number) => {
    for (let i = 0; i < views; i++) {
      await recordEvent({
        workspaceId, projectId, assetId, type: 'page_view', source: 'pixel',
        dedupeKey: `pv:${assetId}:${i}`,
      });
    }
    for (let i = 0; i < sales; i++) {
      await recordEvent({
        workspaceId, projectId, assetId, type: 'sale', source: 'pixel',
        dedupeKey: `sale:${assetId}:${i}`,
      });
    }
  };
  await seedArm(weak.assetId, 100, 1); // 1% CVR — the weak point
  await seedArm(strong.assetId, 50, 10); // 20% CVR

  return { workspaceId, projectId, weak, strong };
}

describe('produce --phase challenge (WO-049)', () => {
  it('reads ledger weak points and lands a fully-gated challenger, queued (acceptance)', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, weak, strong } = await fixtureLedger();
    const { transport, calls } = challengeTransport();
    const progress: string[] = [];

    const summary = await runChallengePhase(
      { projectId, limit: 1 },
      { clientOptions: { transport }, log: (l) => progress.push(l) },
    );

    // Stable summary schema.
    expect(Object.keys(summary).sort()).toEqual(
      ['challengers', 'jobs', 'ok', 'projectId', 'target', 'weakPoints'].sort(),
    );
    expect(summary.ok).toBe(true);
    expect(summary.jobs.failed).toBe(0);

    // The ledger read: the 1%-CVR control is the weak point; the 20% one is not.
    const wpWeak = summary.weakPoints.find((w) => w.controlId === weak.controlId)!;
    const wpStrong = summary.weakPoints.find((w) => w.controlId === strong.controlId)!;
    expect(wpWeak).toMatchObject({ selected: true, note: 'weakest observed CVR', visitors: 100, conversions: 1 });
    expect(wpWeak.cvr).toBeCloseTo(0.01, 5);
    expect(wpStrong.selected).toBe(false);

    // One challenger, through the FULL gate ladder, lifecycle queued.
    expect(summary.challengers).toHaveLength(1);
    const ch = summary.challengers[0]!;
    expect(ch.controlId).toBe(weak.controlId);
    expect(ch.status).toBe('queued');
    expect(ch.gates).toEqual({ G3: 'pass', G4: 'pass', G5: 'pass', G6: 'pass', G7: 'pass' });
    expect(ch.assetStatus).not.toBe('blocked');

    // ACCEPTANCE: the challenger row is in the DB, queued, on the weak control.
    const rows = await tenantDb(workspaceId).findMany(
      challengersTable, eq(challengersTable.controlId, weak.controlId),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('queued');
    expect(rows[0]!.assetId).toBe(ch.assetId);

    // Mocked AI genuinely drove the cascade.
    expect(calls.filter((c) => c === 'challenger')).toHaveLength(1);
    expect(calls.filter((c) => c === 'lens')).toHaveLength(6);
    expect(progress.some((l) => l.includes('challenger.generate'))).toBe(true);
  }, 60_000);

  it('--target overrides the CVR ranking and challenges the named control', async () => {
    if (!dbUp) return;
    const { projectId, strong } = await fixtureLedger();
    const { transport } = challengeTransport();

    const summary = await runChallengePhase(
      { projectId, target: 'upsell@market2' },
      { clientOptions: { transport }, log: () => {} },
    );
    expect(summary.ok).toBe(true);
    expect(summary.challengers).toHaveLength(1);
    expect(summary.challengers[0]!.controlId).toBe(strong.controlId);
    expect(summary.weakPoints.find((w) => w.controlId === strong.controlId)!.note).toBe('targeted');
  }, 60_000);

  it('rejects malformed targets and empty selections', async () => {
    if (!dbUp) return;
    expect(() => parseTarget('vsl-market2')).toThrow(/vsl@market2/);
    expect(parseTarget('vsl@market2')).toEqual({ assetType: 'vsl', marketRank: 2 });

    const { projectId } = await fixtureLedger();
    const miss = await runChallengePhase(
      { projectId, target: 'vsl@market5' },
      { log: () => {} },
    );
    expect(miss.ok).toBe(false);
    expect(miss.error).toMatch(/No control matches/);
  }, 60_000);
});
