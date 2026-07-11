import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import { assertG2Approved, closePool, getDb, projects, tenantDb } from '@copyforge/db';
import { runStrategyPhase } from './strategy.js';

/**
 * CI fixture run (WO-016 acceptance): a seeded fixture project driven through
 * the full strategy phase headlessly with mocked AI — zero tokens spent.
 */

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[strategy.test] MariaDB unreachable — skipping CLI phase tests');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const PROFILE_JSON = {
  schema_version: '1',
  name: 'SpringGuard Pro',
  category: 'home services',
  promise: 'Never get stranded by a snapped spring again',
  mechanism: { problem_mechanism: 'fatigue', solution_mechanism: 'high-cycle coils', name: 'TripleCycle' },
  origin_story: 'founder story',
  founder_voice_samples: [],
  proof_assets: [{ type: 'statistic', ref: '10,000 cycles', strength: 'strong' }],
  enemy: 'cut-rate installers',
  price: { amount: 349, model: 'one-time' },
  guarantees: ['5-year warranty'],
  constraints: { compliance_mode: 'none', banned_claims: [] },
  prior_attempts: [],
  links: [],
};

const OFFER_VARIANT = (name: string) => ({
  schema_version: '1',
  name,
  diagnosis: 'variant angle',
  value_stack: [{ item: 'Install + parts', value_usd: 500, justification: 'real cost' }],
  risk_reversal: '90-day make-it-right guarantee.',
  urgency_mechanisms: [
    { type: 'capacity_limit', description: '12 slots weekly', legitimacy_basis: 'two crews' },
  ],
  price_framing: 'less than one emergency call-out',
  price: { amount: 349, model: 'one-time' },
  offer_name_candidates: ['A', 'B'],
});

const DIAGNOSIS = {
  schema_version: '1',
  rank: 1,
  label: 'ignored',
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screeching door' },
  starving_crowd_scores: { pain: 0, purchasing_power: 0, reachability: 0, urgency: 0, ltv: 0, total: 0 },
  awareness_stage: 'problem',
  awareness_justification: 'Feels symptom daily.',
  sophistication: 2,
  sophistication_justification: 'Low exposure.',
  resident_emotion: 'quiet dread',
  core_desire: 'forget the door exists',
  objections: ['diy', 'upsell', 'quality', 'price', 'trust'],
  voc_corpus_ref: '',
  channels_ranked: ['search'],
  entry_conversation: 'Is this going to snap?',
};

function mockForFullRun(): MockTransport {
  const mock = new MockTransport();
  // 1: intake extraction
  mock.pushText(JSON.stringify(PROFILE_JSON));
  // 2: offer forge (3 variants)
  mock.pushText(
    JSON.stringify({
      diagnosis: 'commodity offer',
      variants: [OFFER_VARIANT('Premium'), OFFER_VARIANT('Risk-led'), OFFER_VARIANT('Urgency-led')],
    }),
  );
  // 3: market selection (8 candidates)
  mock.pushText(
    JSON.stringify({
      candidates: Array.from({ length: 8 }, (_v, i) => ({
        label: `Segment ${i + 1}`,
        avatar_hint: 'hint',
        rationale: 'starving crowd',
        scores: { pain: 9 - i, purchasing_power: 6, reachability: 6, urgency: 6, ltv: 5 },
      })),
    }),
  );
  // 4-8: five market diagnoses
  for (let i = 0; i < 5; i++) mock.pushText(JSON.stringify(DIAGNOSIS));
  return mock;
}

describe('produce --phase strategy (WO-016)', () => {
  it('runs the seeded fixture end-to-end with --auto-approve (exit ok)', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-cli-test-000000');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'CLI fixture' });

    const dumpPath = join(tmpdir(), `copyforge-fixture-${Date.now()}.md`);
    await writeFile(dumpPath, '# SpringGuard sales page dump\nHigh-cycle springs, $349 installed.');

    const summary = await runStrategyPhase(
      { projectId, autoApprove: true, dumpFile: dumpPath },
      { clientOptions: { transport: mockForFullRun() } },
    );

    expect(summary.ok).toBe(true);
    expect(summary.gates).toEqual({ g0: true, g1: true, g2: true });
    expect(summary.steps.intake!.status).toBe('done');
    expect(summary.steps.offer!.status).toBe('done');
    expect(summary.steps.funnelMath!.status).toBe('done');
    expect(summary.steps.marketProfiles!.detail).toContain('5/5');
    expect(summary.markets!.length).toBe(5);
    expect(summary.markets!.every((m) => m.diagnosed)).toBe(true);

    // The build fan-out is actually unlocked.
    await assertG2Approved(workspaceId, projectId);
  });

  it('exits non-ok with the ranked fix list on a G1 hard stop', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-cli-test-111111');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'CLI hard stop' });

    const mock = new MockTransport();
    mock.pushText(JSON.stringify(PROFILE_JSON)); // intake
    mock.pushText(
      JSON.stringify({
        diagnosis: 'weak',
        variants: [OFFER_VARIANT('A'), OFFER_VARIANT('B'), OFFER_VARIANT('C')],
      }),
    );

    const dumpPath = join(tmpdir(), `copyforge-fixture-${Date.now()}-b.md`);
    await writeFile(dumpPath, 'dump');
    const summary = await runStrategyPhase(
      {
        projectId,
        autoApprove: true,
        dumpFile: dumpPath,
        // $349 offer with terrible channel economics → uneconomic.
        math: { margin: 0.3, refundRate: 0.2, channels: [{ name: 'meta', cpc: 8, cvr: 0.002 }] },
      },
      { clientOptions: { transport: mock } },
    );

    expect(summary.ok).toBe(false);
    expect(summary.steps.funnelMath!.status).toBe('blocked');
    expect(summary.steps.funnelMath!.detail).toContain('HARD STOP');
    expect((summary.fixes ?? []).length).toBeGreaterThan(0);
    expect(summary.gates.g1).toBe(false);
  });

  it('stops at the human gate without --auto-approve', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-cli-test-222222');
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'CLI manual' });

    const mock = new MockTransport();
    mock.pushText(JSON.stringify(PROFILE_JSON));
    mock.pushText(
      JSON.stringify({
        diagnosis: 'weak',
        variants: [OFFER_VARIANT('A'), OFFER_VARIANT('B'), OFFER_VARIANT('C')],
      }),
    );

    const dumpPath = join(tmpdir(), `copyforge-fixture-${Date.now()}-c.md`);
    await writeFile(dumpPath, 'dump');
    const summary = await runStrategyPhase(
      { projectId, autoApprove: false, dumpFile: dumpPath },
      { clientOptions: { transport: mock } },
    );
    expect(summary.ok).toBe(false);
    expect(summary.steps.offer!.status).toBe('pending'); // human G0 checkpoint
  });
});
