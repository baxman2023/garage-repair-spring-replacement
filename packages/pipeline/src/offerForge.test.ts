import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, parseOffer } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  getDb,
  getPrompt,
  listOffers,
  projects,
  saveProfileVersion,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';
import { createOfferForgeHandler, OFFER_FORGE_JOB } from './offerForge.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[offerForge.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const VARIANT = (name: string) => ({
  schema_version: '1',
  name,
  diagnosis: '',
  value_stack: [{ item: 'Core service', value_usd: 500, justification: 'labor + parts' }],
  risk_reversal: '90-day make-it-right guarantee.',
  urgency_mechanisms: [
    {
      type: 'capacity_limit',
      description: 'Twelve install slots weekly.',
      legitimacy_basis: 'Two crews at six installs each.',
    },
  ],
  price_framing: 'Costs less than one emergency call-out.',
  price: { amount: 349, model: 'one-time' },
  offer_name_candidates: ['Alt A', 'Alt B'],
});

function makeJob(workspaceId: string, projectId: string): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: OFFER_FORGE_JOB,
    payload: { projectId },
    attempts: 1,
    jobRunId: newId(),
  };
}

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-forge-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Forge test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard Pro', price: { amount: 349, model: 'one-time' } },
  });
  return { workspaceId, projectId };
}

describe('Offer Forge handler (WO-010)', () => {
  it('runs the fable-5 stage over the profile and persists 3 variants', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({
        diagnosis: 'Undifferentiated commodity offer; no risk reversal.',
        variants: [VARIANT('Premium'), VARIANT('Risk-led'), VARIANT('Urgency-led')],
      }),
    );

    await createOfferForgeHandler({ transport: mock })(makeJob(workspaceId, projectId));

    const rows = await listOffers(workspaceId, projectId);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => !r.approved && !r.selected)).toBe(true);
    const parsed = rows.map((r) => parseOffer(r.offer));
    expect(parsed.map((o) => o.name).sort()).toEqual(['Premium', 'Risk-led', 'Urgency-led']);

    // The profile rode in as the user block; the seeded prompt was cached.
    expect(mock.calls[0].req.system?.[0]?.cache).toBe(true);
    expect(mock.calls[0].req.messages[0].content).toContain('SpringGuard Pro');
    const prompt = await getPrompt('offer.forge');
    expect(mock.calls[0].req.system?.[0]?.text).toBe(prompt!.body);
  });

  it('rejects forge output containing fake scarcity — nothing is persisted', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const bad = VARIANT('Shady');
    bad.urgency_mechanisms = [
      {
        type: 'deadline',
        description: 'Fake countdown timer that resets on every visit.',
        legitimacy_basis: 'creates pressure',
      },
    ];
    const mock = new MockTransport();
    mock.pushText(
      JSON.stringify({ diagnosis: 'x', variants: [VARIANT('A'), VARIANT('B'), bad] }),
    );

    await expect(
      createOfferForgeHandler({ transport: mock })(makeJob(workspaceId, projectId)),
    ).rejects.toThrow();
    expect(await listOffers(workspaceId, projectId)).toEqual([]);
  });

  it('requires a product profile first', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-forge-test-111111');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'No profile' });
    const mock = new MockTransport();
    await expect(
      createOfferForgeHandler({ transport: mock })(makeJob(workspaceId, projectId)),
    ).rejects.toThrow(/profile/i);
    expect(mock.calls.length).toBe(0);
  });
});
