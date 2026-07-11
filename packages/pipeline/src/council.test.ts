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
    const mock = new MockTransport();
    // Round 1: 6 lens calls — halbert & carlton fail hard, others mediocre.
    const round1 = { schwartz: 72, halbert: 55, bencivenga: 74, sugarman: 71, kennedy: 75, carlton: 58 };
    for (const lens of COUNCIL_LENSES) mock.pushText(lensJson(round1[lens], round1[lens] < 70));
    // Revision call returns the improved draft.
    mock.pushText(JSON.stringify({ blocks: GOOD_BLOCKS }));
    // Round 2: everything strong.
    for (const _lens of COUNCIL_LENSES) mock.pushText(lensJson(88, false));

    const outcome = await createCouncilRunner({ transport: mock })({
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
    const revisionCall = mock.calls[6]!; // calls 0-5 = round-1 lenses
    expect(revisionCall.req.messages[0].content).toContain('HALBERT');
    expect(revisionCall.req.messages[0].content).toContain('CARLTON');
    expect(revisionCall.req.messages[0].content).not.toContain('KENNEDY');
    // Persona corpus + market block cached on lens calls (§1.2).
    expect(mock.calls[0].req.system?.length).toBe(2);
    expect(mock.calls[0].req.system?.every((b) => b.cache)).toBe(true);

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
