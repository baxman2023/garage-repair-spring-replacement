import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUNCIL_LENSES, newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  createAsset,
  getAsset,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  listCouncilReviewsForAsset,
  projects,
  tenantDb,
} from '@copyforge/db';
import { createCouncilRunner } from './council.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[council.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const BAD_BLOCKS = [
  { id: 'headline', role: 'headline', text: 'Are you tired of garage door problems?' },
  { id: 'lead', role: 'lead', text: 'We are a company that values quality and service.' },
  { id: 'close', role: 'close', text: 'Contact us today for more information.' },
];

const GOOD_BLOCKS = [
  { id: 'headline', role: 'headline', text: 'The Six A.M. Snap That Traps Your Car — And The Ninety-Second Check That Prevents It' },
  { id: 'lead', role: 'lead', text: 'You heard it before you saw it. That gunshot crack from the garage…' },
  { id: 'close', role: 'close', text: 'Twelve install slots this week — two crews, six doors each. Claim yours.' },
];

const lensJson = (score: number, failing: boolean) =>
  JSON.stringify({
    score,
    verdict: failing ? 'revise' : 'pass',
    top_fixes: failing ? ['Open on the felt symptom, not the company'] : [],
    line_notes: failing ? [{ block_id: 'lead', note: 'Corporate throat-clearing; no A-pile energy' }] : [],
  });

/**
 * Lens calls run in PARALLEL, so a FIFO mock maps responses to lenses
 * nondeterministically. This transport reads the lens name out of the request
 * and answers per-round scores deterministically; revision calls advance the
 * round.
 */
function lensAwareTransport(rounds: Array<Record<string, number>>, revisions: unknown[]) {
  let round = 0;
  let revisionIndex = 0;
  const calls: Array<{ content: string; system: string[] }> = [];
  return {
    calls,
    transport: {
      async createMessage(req: { messages: { content: string }[]; system?: { text: string; cache?: boolean }[]; model: string }) {
        const content = req.messages[0]!.content;
        calls.push({ content, system: (req.system ?? []).map((b) => b.text) });
        let text: string;
        const lensMatch = /LENS FOR THIS CALL: (\w+)/.exec(content);
        if (lensMatch) {
          const score = rounds[round]![lensMatch[1]!]!;
          text = lensJson(score, score < 70);
        } else {
          text = JSON.stringify(revisions[revisionIndex++]);
          round++;
        }
        return {
          model: req.model,
          text,
          stopReason: 'end_turn',
          usage: { inputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 5 },
        };
      },
    },
  };
}

async function setup(): Promise<{ workspaceId: string; projectId: string; assetId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-council-test-0000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Council test' });
  const assetId = await createAsset({ workspaceId, projectId, type: 'sales_letter' });
  await insertAssetVersion({ workspaceId, assetId, blocks: BAD_BLOCKS, createdBy: 'system' });
  return { workspaceId, projectId, assetId };
}

describe('Council engine (WO-020 / G3)', () => {
  it('bad draft fails round 1, revision improves it, round 2 passes — all on record', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup();
    // Round 1: halbert & carlton fail hard, others mediocre. Round 2: strong.
    const { transport, calls } = lensAwareTransport(
      [
        { schwartz: 72, halbert: 55, bencivenga: 74, sugarman: 71, kennedy: 75, carlton: 58 },
        { schwartz: 88, halbert: 88, bencivenga: 88, sugarman: 88, kennedy: 88, carlton: 88 },
      ],
      [{ blocks: GOOD_BLOCKS }],
    );

    const outcome = await createCouncilRunner({ transport })({
      workspaceId,
      projectId,
      assetId,
      marketBlock: 'MARKET PROFILE — test crowd',
    });

    expect(outcome.pass).toBe(true);
    expect(outcome.escalated).toBe(false);
    expect(outcome.loops.length).toBe(2);
    expect(outcome.loops[0]!.pass).toBe(false);
    expect(outcome.loops[1]!.pass).toBe(true);
    expect(outcome.loops[1]!.aggregate).toBeGreaterThan(outcome.loops[0]!.aggregate); // improved on record

    // Reviews persisted per version: v1 six rows (with fails), v2 six rows (pass).
    const grouped = await listCouncilReviewsForAsset(workspaceId, assetId);
    expect(grouped.length).toBe(2);
    const v2 = grouped[0]!;
    const v1 = grouped[1]!;
    expect(v1.reviews.length).toBe(6);
    expect(v2.reviews.length).toBe(6);
    expect(v1.reviews.some((r) => r.verdict === 'revise')).toBe(true);
    expect(v2.reviews.every((r) => r.verdict === 'pass')).toBe(true);

    // The revision prompt contained ONLY the failing lenses' notes.
    const revisionCall = calls.find((c) => c.content.includes('REVISION BRIEF'))!;
    expect(revisionCall.content).toContain('HALBERT');
    expect(revisionCall.content).toContain('CARLTON');
    expect(revisionCall.content).not.toContain('KENNEDY');
    // Persona corpus + market block ride as two system blocks on lens calls (§1.2).
    expect(calls[0]!.system.length).toBe(2);
    expect(calls[0]!.system[1]).toContain('MARKET PROFILE');

    // Asset advanced out of council.
    const asset = await getAsset(workspaceId, assetId);
    expect(asset!.status).toBe('council'); // gate recorded; WO-021 moves it onward
  });

  it('escalates with notes after 3 failing loops and blocks the asset', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup();
    const mock = new MockTransport();
    for (let round = 0; round < 3; round++) {
      for (const _lens of COUNCIL_LENSES) mock.pushText(lensJson(60, true));
      if (round < 2) mock.pushText(JSON.stringify({ blocks: BAD_BLOCKS })); // revisions that do not help
    }

    const outcome = await createCouncilRunner({ transport: mock })({
      workspaceId,
      projectId,
      assetId,
      marketBlock: 'MARKET PROFILE — test crowd',
    });

    expect(outcome.pass).toBe(false);
    expect(outcome.escalated).toBe(true);
    expect(outcome.loops.length).toBe(3);
    expect(outcome.escalationNotes).toContain('REVISION BRIEF');
    expect((await getAsset(workspaceId, assetId))!.status).toBe('blocked');
    // Three versions reviewed (v1 + two failed revisions), six reviews each.
    const grouped = await listCouncilReviewsForAsset(workspaceId, assetId);
    expect(grouped.length).toBe(3);
    expect(grouped.every((g) => g.reviews.length === 6)).toBe(true);
  });

  it('config-driven thresholds: a lenient config passes what defaults fail', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, assetId } = await setup();
    const mock = new MockTransport();
    for (const _lens of COUNCIL_LENSES) mock.pushText(lensJson(75, false));

    const outcome = await createCouncilRunner({ transport: mock })({
      workspaceId,
      projectId,
      assetId,
      marketBlock: 'MARKET',
      config: {
        aggregateThreshold: 70,
        lensFloor: 60,
        weights: { schwartz: 1, halbert: 1, bencivenga: 1, sugarman: 1, kennedy: 1, carlton: 1 },
      },
    });
    expect(outcome.pass).toBe(true);
    expect(outcome.loops.length).toBe(1);

    const version = await getCurrentAssetVersion(workspaceId, assetId);
    expect(version!.version).toBe(1); // no revision needed
  });
});
