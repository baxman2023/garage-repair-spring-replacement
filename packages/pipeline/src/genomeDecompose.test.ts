import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  addSwipe,
  closePool,
  getDb,
  queryGenomeComponents,
  type ClaimedJob,
} from '@copyforge/db';
import { createGenomeDecomposeHandler, GENOME_DECOMPOSE_JOB } from './genomeDecompose.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[genomeDecompose.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function makeJob(workspaceId: string, swipeId: string): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: GENOME_DECOMPOSE_JOB,
    payload: { swipeId },
    attempts: 1,
    jobRunId: newId(),
  };
}

const component = (type: string, i: number) => ({
  type,
  content: {
    summary: `structural move ${i}`,
    evidence: `verbatim excerpt ${i}`,
    pattern: 'named-pattern',
  },
  confidence: 0.85,
  tags: ['garage', 'meta'],
});

const TYPES = ['lead', 'mechanism_name', 'proof_stack', 'price_reveal', 'close', 'bullet_style', 'headline_pattern'];

describe('genome decomposer (WO-017)', () => {
  it('10-swipe fixture: ≥90% of components typed, queryable by type+niche', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-genome-test-00000');
    const niche = `garage-${Date.now()}`;

    const mock = new MockTransport();
    let totalEmitted = 0;
    let totalTyped = 0;
    let expectedComponents = 0;
    for (let s = 0; s < 10; s++) {
      // Each swipe yields 6 typed components. Every third swipe also emits an
      // untyped stray plus extra typed headline patterns so each individual
      // decomposition (and the fixture overall) stays ≥ 90% typed.
      const comps: unknown[] = TYPES.slice(0, 6).map((t, i) => component(t, s * 10 + i));
      totalTyped += 6;
      totalEmitted += 6;
      expectedComponents += 6;
      if (s % 3 === 0) {
        for (let j = 0; j < 4; j++) comps.push(component('headline_pattern', s * 100 + j));
        comps.push({ type: 'vibes', content: { summary: 'x', evidence: 'y' }, confidence: 0.5 });
        totalTyped += 4;
        totalEmitted += 5;
        expectedComponents += 4;
      }
      mock.pushText(JSON.stringify({ niche, channel: 'meta', awareness: 'problem', components: comps }));
    }

    const handler = createGenomeDecomposeHandler({ clientOptions: { transport: mock } });
    for (let s = 0; s < 10; s++) {
      const swipeId = await addSwipe({
        workspaceId,
        rawSource: `Winning ad number ${s} — long-form copy…`,
        niche,
        channel: 'meta',
      });
      await handler(makeJob(workspaceId, swipeId));
    }

    expect(totalTyped / totalEmitted).toBeGreaterThanOrEqual(0.9); // fixture honest

    // Queryable by type+niche (acceptance).
    const leads = await queryGenomeComponents({ workspaceId, type: 'lead', niche });
    expect(leads.length).toBe(10);
    expect(leads.every((c) => c.type === 'lead' && c.niche === niche)).toBe(true);
    const all = await queryGenomeComponents({ workspaceId, niche });
    expect(all.length).toBe(expectedComponents);
    expect(Number(all[0]!.confidence)).toBeCloseTo(0.85, 2);
  });

  it('fails loudly when a decomposition falls below the 90% typed bar', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-genome-test-11111');
    const swipeId = await addSwipe({ workspaceId, rawSource: 'junk swipe', niche: 'x' });
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({
        components: [component('lead', 1), { type: 'junk1' }, { type: 'junk2' }],
      }),
    );
    await expect(
      createGenomeDecomposeHandler({ clientOptions: { transport: mock } })(makeJob(workspaceId, swipeId)),
    ).rejects.toThrow(/quality bar/);
    expect((await queryGenomeComponents({ workspaceId, niche: 'x' })).length).toBe(0);
  });

  it('workspace privacy: another workspace cannot decompose or see private swipes', async () => {
    if (!dbUp) return;
    const owner = newId();
    const intruder = newId();
    await storeWorkspaceKey(intruder, 'sk-ant-genome-test-22222');
    const niche = `private-${Date.now()}`;
    const swipeId = await addSwipe({ workspaceId: owner, rawSource: 'private swipe', niche });

    const mock = new MockTransport();
    await expect(
      createGenomeDecomposeHandler({ clientOptions: { transport: mock } })(makeJob(intruder, swipeId)),
    ).rejects.toThrow(/not found/i);
    expect(mock.calls.length).toBe(0);
    expect((await queryGenomeComponents({ workspaceId: intruder, niche })).length).toBe(0);
  });
});
