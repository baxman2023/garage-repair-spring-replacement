import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AssetBlock } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  createAsset,
  designateControlIfFirst,
  getCurrentAssetVersion,
  getDb,
  insertAssetVersion,
  insertCouncilReviews,
  insertFocusGroupRun,
  recordEvent,
  tenantDb,
  challengers as challengersTable,
  markets,
  projects,
  assets as assetsTable,
  jobs,
  type ClaimedJob,
} from '@copyforge/db';
import { CHALLENGER_GENERATE_JOB, buildChallengerBrief, createChallengerGenerateHandler } from './challenger.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[challenger.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const BLOCKS: AssetBlock[] = [
  { id: 'hook', role: 'hook', text: 'The bang at six a.m.' },
  { id: 'offer', role: 'offer', text: 'The kit, installed.' },
  { id: 'cta', role: 'cta', text: 'Book the fix.' },
];

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string; controlId: string; controlAsset: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-chal-test-00000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Challenger test' });
  const marketId = await tenantDb(workspaceId).insert(markets, {
    projectId, rank: 1, label: 'M1', schemaVersion: '1', profile: { origin: 'engine' },
  });
  const controlAsset = await createAsset({ workspaceId, projectId, marketId, type: 'vsl' });
  const version = await insertAssetVersion({ workspaceId, assetId: controlAsset, blocks: BLOCKS, createdBy: 'system' });

  // Recorded weaknesses: a revise-verdict council review, focus annotations, ledger numbers.
  await insertCouncilReviews({
    workspaceId,
    assetVersionId: version.id,
    results: {
      halbert: {
        score: 62,
        verdict: 'revise',
        top_fixes: ['Open on the felt symptom, not the product'],
        line_notes: [],
      },
    } as never,
  });
  await insertFocusGroupRun({
    workspaceId,
    assetVersionId: version.id,
    annotations: { annotations: [{ blockId: 'offer', kind: 'disbelief', count: 9, note: 'Disbelief (9/20): "the kit"' }] },
    pass: false,
    report: {},
  });
  await recordEvent({
    workspaceId, projectId, assetId: controlAsset, type: 'page_view', source: 'pixel',
    sessionRef: 's1', dedupeKey: `pv:${controlAsset}:1`,
  });
  await recordEvent({
    workspaceId, projectId, assetId: controlAsset, type: 'sale', source: 'pixel',
    sessionRef: 's1', dedupeKey: `sale:${controlAsset}:1`,
  });

  const { controlId } = await designateControlIfFirst({ workspaceId, assetId: controlAsset });
  return { workspaceId, projectId, marketId, controlId: controlId!, controlAsset };
}

describe('challenger generation (WO-044)', () => {
  it('briefs from council notes, focus annotations, and ledger weak points', async () => {
    if (!dbUp) return;
    const { workspaceId, controlAsset } = await setup();
    const brief = await buildChallengerBrief(workspaceId, controlAsset);
    expect(brief).toContain('COUNCIL (halbert, 62): Open on the felt symptom');
    expect(brief).toContain('FOCUS GROUP [block offer · disbelief]');
    expect(brief).toContain('LEDGER: 1 visitors → 1 sales');
  });

  it('creates the challenger asset (parent-linked, createdBy challenger), queues it, re-enters council', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId, controlId, controlAsset } = await setup();
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({
        blocks: BLOCKS.map((b) => ({ ...b, text: `${b.text} (challenger take)` })),
      }),
    );

    const job: ClaimedJob = {
      id: newId(), workspaceId, type: CHALLENGER_GENERATE_JOB,
      payload: { controlId }, attempts: 1, jobRunId: newId(),
    };
    await createChallengerGenerateHandler({ transport: mock })(job);

    expect(String(mock.calls[0]!.req.messages[0]!.content)).toContain('CHALLENGER BRIEF');

    const challengerRows = await tenantDb(workspaceId).findMany(challengersTable, eq(challengersTable.controlId, controlId));
    expect(challengerRows).toHaveLength(1);
    expect(challengerRows[0]!.status).toBe('queued');

    const challengerAsset = await tenantDb(workspaceId).findFirst(
      assetsTable,
      eq(assetsTable.id, challengerRows[0]!.assetId),
    );
    expect(challengerAsset!.parentAssetId).toBe(controlAsset);
    expect(challengerAsset!.type).toBe('vsl');
    expect(challengerAsset!.marketId).toBe(marketId);
    const version = await getCurrentAssetVersion(workspaceId, challengerAsset!.id);
    expect(version!.createdBy).toBe('challenger');
    expect((version!.blocks as AssetBlock[])[0]!.text).toContain('(challenger take)');

    const queued = await getDb().select().from(jobs).where(eq(jobs.workspaceId, workspaceId));
    expect(
      queued.some(
        (j) => j.type === 'asset.council' && (j.payload as { assetId: string }).assetId === challengerAsset!.id,
      ),
    ).toBe(true);
    expect((queued[0]?.payload as { projectId?: string })?.projectId ?? projectId).toBe(projectId);
  });
});
