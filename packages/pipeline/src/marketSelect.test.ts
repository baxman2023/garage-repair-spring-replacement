import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  getDb,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';
import { createMarketSelectHandler, MARKET_SELECT_JOB } from './marketSelect.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[marketSelect.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function makeJob(workspaceId: string, projectId: string): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: MARKET_SELECT_JOB,
    payload: { projectId },
    attempts: 1,
    jobRunId: newId(),
  };
}

const candidate = (label: string, pain: number) => ({
  label,
  avatar_hint: 'hint',
  rationale: `${label} is starving`,
  scores: { pain, purchasing_power: 5, reachability: 5, urgency: 5, ltv: 5 },
});

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-mkt-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Market test' });
  await saveProfileVersion({ workspaceId, projectId, profile: { schema_version: '1', name: 'P' } });
  const [offerId] = await saveOfferVariants({
    workspaceId,
    projectId,
    variants: [{ schema_version: '1', name: 'Offer' }],
  });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  return { workspaceId, projectId };
}

describe('Market Selection handler (WO-012)', () => {
  it('generates, ranks by weighted score, persists top 5 with rationale', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const mock = new MockTransport();
    // 9 candidates with distinct pain (weighted 0.25) so ranking is deterministic.
    mock.pushText(
      JSON.stringify({
        candidates: [3, 9, 5, 10, 1, 7, 4, 8, 2].map((p) => candidate(`C-pain${p}`, p)),
      }),
    );
    await createMarketSelectHandler({ transport: mock })(makeJob(workspaceId, projectId));

    const rows = await listMarkets(workspaceId, projectId);
    expect(rows.map((r) => r.label)).toEqual([
      'C-pain10',
      'C-pain9',
      'C-pain8',
      'C-pain7',
      'C-pain5',
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.rationale!.includes('starving'))).toBe(true);
    expect(Number(rows[0]!.scoreTotal)).toBeGreaterThan(Number(rows[4]!.scoreTotal));
    // Profile and offer both rode in the user block.
    expect(mock.calls[0].req.messages[0].content).toContain('PRODUCT PROFILE');
    expect(mock.calls[0].req.messages[0].content).toContain('APPROVED OFFER');
  });

  it('rejects out-of-contract candidate counts', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify({ candidates: [candidate('only', 5)] }));
    await expect(
      createMarketSelectHandler({ transport: mock })(makeJob(workspaceId, projectId)),
    ).rejects.toThrow();
    expect(await listMarkets(workspaceId, projectId)).toEqual([]);
  });

  it('requires an approved offer (G0) before selecting markets', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-mkt-test-111111');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'No G0' });
    await saveProfileVersion({ workspaceId, projectId, profile: { schema_version: '1' } });
    const mock = new MockTransport();
    await expect(
      createMarketSelectHandler({ transport: mock })(makeJob(workspaceId, projectId)),
    ).rejects.toThrow(/G0/);
    expect(mock.calls.length).toBe(0);
  });
});
