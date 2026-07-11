import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';

process.env.EXPORT_DIR = join(tmpdir(), `copyforge-exports-cli-${process.pid}`);
import { storeWorkspaceKey, type Transport } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  buildStrategySnapshot,
  closePool,
  getDb,
  listMarkets,
  projects,
  recordFunnelMathRun,
  recordG0,
  recordG2,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
} from '@copyforge/db';
import { runBuildPhase } from './build.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[cli build.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

// G5-calibrated fixture copy (grade in band, zero tells, specifics, rhythm).
const UPSELL_BLOCKS = [
  { id: 'hl', role: 'headline', text: 'Your order is complete, and your SpringGuard installation is officially scheduled.' },
  { id: 'lead', role: 'lead', text: 'One decision remains before you go. The Torsion Tune-Up Guide shows the maintenance routine our installers perform on their own garage doors, and it typically extends a replacement spring by several additional seasons. It normally sells separately, and today it is bundled into this order alone.' },
  { id: 'offer', role: 'offer', text: 'Add it once. Keep it forever.' },
  { id: 'cta', role: 'cta', text: 'Add the Torsion Tune-Up Guide to my order' },
  { id: 'decline', role: 'body', text: 'No thanks, take me to my order', meta: { section: 'decline' } },
];
const BUMP_JSON = {
  headline: 'Wait — the Emergency Release Kit belongs with this order.',
  body: 'It contains the release cable and the illustrated instructions our SpringGuard technicians carry on every installation visit. When a spring fails and the opener will not respond, this kit is how a trapped car leaves the garage safely. One click covers it.',
  checkbox_line: 'Yes, add the Emergency Release Kit to my order',
};
const SLOPPY_UPSELL_BLOCKS = [
  { id: 'hl', role: 'headline', text: 'In today’s world, congratulations on navigating the complexities of your purchase journey.' },
  { id: 'lead', role: 'lead', text: 'It is important to note that homeowners frequently delve into maintenance without understanding the considerations involved. Furthermore, the associated benefits are considerable and should not be underestimated by anyone at all.' },
  { id: 'cta', role: 'cta', text: 'Unlock the next level of your garage experience today' },
  { id: 'decline', role: 'body', text: 'No thanks, take me to my order', meta: { section: 'decline' } },
];

const LENS_PASS = JSON.stringify({ score: 88, verdict: 'pass', top_fixes: [], line_notes: [] });

/** Routes responses by request content — the full gate cascade, zero tokens. */
function cascadeTransport(opts: { sloppyUpsell?: boolean } = {}) {
  const calls: string[] = [];
  const transport: Transport = {
    async createMessage(req) {
      const system = (req.system ?? []).map((b) => b.text).join('\n');
      const user = req.messages[0]?.content ?? '';
      let text: string;

      if (user.includes('LENS FOR THIS CALL')) {
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
      } else if (system.includes('line editor')) {
        calls.push('rewrite');
        // A "rewrite" that fixes nothing — G5 exhausts its loops.
        text = JSON.stringify({ blocks: SLOPPY_UPSELL_BLOCKS });
      } else if (user.includes('order-bump copy')) {
        calls.push('bump');
        text = JSON.stringify(BUMP_JSON);
      } else if (user.includes('upsell page')) {
        calls.push('upsell');
        text = JSON.stringify({ blocks: opts.sloppyUpsell ? SLOPPY_UPSELL_BLOCKS : UPSELL_BLOCKS });
      } else {
        throw new Error(`cascadeTransport: unroutable request: ${user.slice(0, 120)}`);
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

/** Fixture project with G0–G2 complete (5 diagnosed markets, approved). */
async function fixtureProject(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-cli-build-00000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'CLI build fixture' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
  });
  const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [{ schema_version: '1', name: 'O' }] });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await recordFunnelMathRun({ workspaceId, projectId, inputs: {}, outputs: {}, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
  });
  for (const m of await listMarkets(workspaceId, projectId)) {
    await applyMarketProfile({
      workspaceId,
      projectId,
      marketId: m.id,
      profile: {
        schema_version: '1',
        rank: m.rank,
        label: m.label,
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
  }
  await recordG2({ workspaceId, projectId, snapshot: await buildStrategySnapshot(workspaceId, projectId) });
  return { workspaceId, projectId };
}

describe('produce --phase build (WO-034)', () => {
  it('fixture project builds end-to-end headless through every gate (acceptance)', async () => {
    if (!dbUp) return;
    const { projectId } = await fixtureProject();
    const { transport, calls } = cascadeTransport();
    const progress: string[] = [];

    const summary = await runBuildPhase(
      { projectId, markets: [1], assets: ['upsell', 'order_bump'] },
      { clientOptions: { transport }, log: (l) => progress.push(l) },
    );

    // Stable summary schema.
    expect(Object.keys(summary).sort()).toEqual(
      ['assets', 'blocked', 'build', 'buildId', 'jobs', 'ok', 'projectId'].sort(),
    );
    expect(summary.ok).toBe(true);
    expect(summary.build!.status).toBe('done');
    expect(summary.build!.steps.map((s) => s.status)).toEqual(['done', 'done']);
    expect(summary.jobs.failed).toBe(0);
    expect(summary.blocked).toEqual([]);

    // Per-asset gate outcomes: the FULL gate ladder passes — G7 composes the
    // package, exports files, and compiles both build prompts.
    expect(summary.assets).toHaveLength(2);
    for (const asset of summary.assets) {
      expect(asset.marketRank).toBe(1);
      expect(asset.status).toBe('packaging');
      expect(asset.gates).toEqual({ G3: 'pass', G4: 'pass', G5: 'pass', G6: 'pass', G7: 'pass' });
    }

    // The cascade genuinely ran: generation, claims, 6 lenses × 2, focus batches.
    expect(calls.filter((c) => c === 'lens')).toHaveLength(12);
    expect(calls.filter((c) => c === 'focus')).toHaveLength(8); // 20 personas / 5 per batch × 2 assets
    expect(calls).toContain('upsell');
    expect(calls).toContain('bump');

    // Progress streamed.
    expect(progress.some((l) => l.includes('build.step'))).toBe(true);
    expect(progress.some((l) => l.includes('asset.council'))).toBe(true);
  }, 60_000);

  it('a blocked asset yields ok:false and appears in summary.blocked (non-zero exit)', async () => {
    if (!dbUp) return;
    const { projectId } = await fixtureProject();
    const { transport } = cascadeTransport({ sloppyUpsell: true });

    const summary = await runBuildPhase(
      { projectId, markets: [1], assets: ['upsell'] },
      { clientOptions: { transport }, log: () => {} },
    );

    expect(summary.ok).toBe(false);
    expect(summary.blocked).toHaveLength(1);
    const asset = summary.assets.find((a) => a.assetId === summary.blocked[0])!;
    expect(asset.status).toBe('blocked');
    expect(asset.gates.G5).toBe('fail'); // de-slop exhausted its rewrite loops
    expect(asset.gates.G3).toBe('pass');
  }, 60_000);

  it('refuses to build without G2', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-cli-nog2-00000');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'No G2' });
    const summary = await runBuildPhase({ projectId }, { log: () => {} });
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/G2/);
  });
});
