import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, parseMarketProfile } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  closePool,
  getDb,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  updateMarket,
  type ClaimedJob,
} from '@copyforge/db';
import { createMarketProfileHandler, MARKET_PROFILE_JOB } from './marketProfile.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[marketProfile.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function makeJob(workspaceId: string, projectId: string, marketId: string): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: MARKET_PROFILE_JOB,
    payload: { projectId, marketId },
    attempts: 1,
    jobRunId: newId(),
  };
}

const DIAGNOSIS = {
  schema_version: '1',
  rank: 99, // wrong on purpose — the handler must pin the stored rank
  label: 'model-echoed label that must be ignored',
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'door screeching' },
  starving_crowd_scores: { pain: 0, purchasing_power: 0, reachability: 0, urgency: 0, ltv: 0, total: 0 },
  awareness_stage: 'problem',
  awareness_justification: 'Feels the symptom daily, cause unknown.',
  sophistication: 2,
  sophistication_justification: 'Little prior claim exposure.',
  resident_emotion: 'quiet dread',
  core_desire: 'never think about the door again',
  objections: ['diy', 'upsells', 'part quality', 'price', 'trust'],
  voc_corpus_ref: '',
  channels_ranked: ['search', 'meta'],
  entry_conversation: 'Is this thing going to snap on me?',
};

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-mprof-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Profile test' });
  await saveProfileVersion({ workspaceId, projectId, profile: { schema_version: '1', name: 'P' } });
  const [offerId] = await saveOfferVariants({
    workspaceId,
    projectId,
    variants: [{ schema_version: '1', name: 'Offer' }],
  });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({
      label: `Market ${i + 1}`,
      rationale: 'starving',
      total: 80 - i * 3,
      profile: { scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4 } },
    })),
  });
  return { workspaceId, projectId };
}

describe('market profile handler (WO-013)', () => {
  it('produces 5 contract-valid profiles with pinned identity + mirrored columns', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const markets = await listMarkets(workspaceId, projectId);
    expect(markets.length).toBe(5);

    const mock = new MockTransport();
    for (let i = 0; i < 5; i++) mock.pushText(JSON.stringify(DIAGNOSIS));
    const handler = createMarketProfileHandler({ transport: mock });
    for (const m of markets) {
      await handler(makeJob(workspaceId, projectId, m.id));
    }

    const profiled = await listMarkets(workspaceId, projectId);
    for (const m of profiled) {
      const profile = parseMarketProfile(m.profile); // contract-valid
      expect(profile.rank).toBe(m.rank); // pinned, not the model's echo (99)
      expect(profile.label).toBe(m.label);
      expect(profile.starving_crowd_scores.pain).toBe(8); // pinned from WO-012 scores
      expect(m.awarenessStage).toBe('problem'); // mirrored columns
      expect(m.sophistication).toBe(2);
      expect(m.residentEmotion).toBe('quiet dread');
    }
  });

  it('preserves the user-origin marker through profiling', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const markets = await listMarkets(workspaceId, projectId);
    await updateMarket({ workspaceId, projectId, marketId: markets[0]!.id, label: 'Mine' });

    const mock = new MockTransport();
    mock.pushText(JSON.stringify(DIAGNOSIS));
    await createMarketProfileHandler({ transport: mock })(
      makeJob(workspaceId, projectId, markets[0]!.id),
    );
    const after = (await listMarkets(workspaceId, projectId)).find((m) => m.id === markets[0]!.id)!;
    expect((after.profile as { origin?: string }).origin).toBe('user');
    expect(after.label).toBe('Mine');
  });

  it('rejects an incomplete diagnosis — nothing persisted', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const markets = await listMarkets(workspaceId, projectId);
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ ...DIAGNOSIS, objections: ['only', 'four', 'of', 'them'] }));
    await expect(
      createMarketProfileHandler({ transport: mock })(
        makeJob(workspaceId, projectId, markets[0]!.id),
      ),
    ).rejects.toThrow();
    const after = (await listMarkets(workspaceId, projectId)).find((m) => m.id === markets[0]!.id)!;
    expect(after.awarenessStage).toBeNull();
  });
});
