import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  addVocSource,
  closePool,
  getDb,
  listMarketPhrases,
  listVocSources,
  markets,
  projects,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';
import { createVocMineHandler, VOC_MINE_JOB } from './vocMine.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[vocMine.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function makeJob(workspaceId: string, projectId: string, sourceId: string): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: VOC_MINE_JOB,
    payload: { projectId, sourceId },
    attempts: 1,
    jobRunId: newId(),
  };
}

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-voc-test-000000');
  const db = tenantDb(workspaceId);
  const projectId = await db.insert(projects, { name: 'VOC test' });
  const marketId = await db.insert(markets, {
    projectId,
    rank: 1,
    label: 'Homeowners',
    profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, marketId };
}

describe('VOC miner (WO-014)', () => {
  it('mines a paste source into typed phrases traceable to the source', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const sourceId = await addVocSource({
      workspaceId,
      projectId,
      marketId,
      kind: 'paste',
      rawContent: 'Review dump: the spring snapped at 6am. These guys always upsell.',
    });
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({
        phrases: [
          { phrase: 'the spring snapped at 6am', kind: 'pain' },
          { phrase: 'these guys always upsell', kind: 'objection' },
          { phrase: 'I just want it to work', kind: 'desire' },
        ],
      }),
    );
    await createVocMineHandler({ clientOptions: { transport: mock } })(
      makeJob(workspaceId, projectId, sourceId),
    );

    const phrases = await listMarketPhrases(workspaceId, marketId);
    expect(phrases.length).toBe(3);
    expect(new Set(phrases.map((p) => p.kind))).toEqual(new Set(['pain', 'objection', 'desire']));
    expect(phrases.every((p) => p.sourceRef === sourceId)).toBe(true); // traceable
  });

  it('URL sources are fetched, readability-extracted, and content persisted', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const sourceId = await addVocSource({
      workspaceId,
      projectId,
      marketId,
      kind: 'url',
      ref: 'https://example.com/reviews',
    });
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ phrases: [{ phrase: 'never coming back here', kind: 'objection' }] }));
    await createVocMineHandler({
      clientOptions: { transport: mock },
      fetcher: async () =>
        '<html><body><p>Never coming back here.</p><script>x()</script></body></html>',
    })(makeJob(workspaceId, projectId, sourceId));

    expect(mock.calls[0].req.messages[0].content).toContain('Never coming back here.');
    expect(mock.calls[0].req.messages[0].content).not.toContain('x()');
    const sources = await listVocSources(workspaceId, marketId);
    expect(sources[0]!.rawContent).toContain('Never coming back here.');
    expect(sources[0]!.fetchedAt).not.toBeNull();
  });

  it('dedupes across successive mines and within a batch', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const s1 = await addVocSource({ workspaceId, projectId, marketId, kind: 'paste', rawContent: 'a' });
    const s2 = await addVocSource({ workspaceId, projectId, marketId, kind: 'paste', rawContent: 'b' });
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({
        phrases: [
          { phrase: 'The spring snapped at 6am', kind: 'pain' },
          { phrase: 'the spring SNAPPED at 6am!', kind: 'pain' }, // in-batch dupe
        ],
      }),
    );
    mock.pushText(
      JSON.stringify({
        phrases: [
          { phrase: 'the spring snapped at 6am…', kind: 'pain' }, // cross-source dupe
          { phrase: 'I just want it to work', kind: 'desire' },
        ],
      }),
    );
    const handler = createVocMineHandler({ clientOptions: { transport: mock } });
    await handler(makeJob(workspaceId, projectId, s1));
    await handler(makeJob(workspaceId, projectId, s2));

    const phrases = await listMarketPhrases(workspaceId, marketId);
    expect(phrases.length).toBe(2);
  });

  it('builds a 200-phrase corpus in one job well under the 2-minute budget', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const sourceId = await addVocSource({
      workspaceId,
      projectId,
      marketId,
      kind: 'paste',
      rawContent: 'big dump '.repeat(100),
    });
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({
        phrases: Array.from({ length: 200 }, (_v, i) => ({
          phrase: `distinct customer phrase number ${i} about springs`,
          kind: (['pain', 'desire', 'objection', 'identity'] as const)[i % 4],
        })),
      }),
    );
    const started = Date.now();
    await createVocMineHandler({ clientOptions: { transport: mock } })(
      makeJob(workspaceId, projectId, sourceId),
    );
    const elapsedMs = Date.now() - started;

    const phrases = await listMarketPhrases(workspaceId, marketId);
    expect(phrases.length).toBe(200);
    expect(elapsedMs).toBeLessThan(120_000);
  });
});
