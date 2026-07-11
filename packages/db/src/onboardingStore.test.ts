import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import { saveProfileVersion } from './profiles.js';
import { recordG0, saveOfferVariants, selectOffer } from './offers.js';
import { recordFunnelMathRun } from './funnelMath.js';
import { applyEngineCandidates, applyMarketProfile, listMarkets } from './markets.js';
import { buildStrategySnapshot, recordG2 } from './strategyGate.js';
import { onboardingProgress } from './onboardingStore.js';
import { projects } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[onboardingStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('First Funnel Today checklist (WO-054 acceptance)', () => {
  it('walks a new user to an approved strategy (G2) with the next-action pointer at every step', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Onboarding walk' });

    // Fresh project: nothing done, the pointer says "profile" and links somewhere real.
    let p = await onboardingProgress(workspaceId, projectId);
    expect(p.steps.map((s) => s.done)).toEqual([false, false, false, false, false, false]);
    expect(p.next!.key).toBe('profile');
    expect(p.next!.href).toBe(`/projects/${projectId}`);
    expect(p.next!.hint).toContain('Sales Detective');
    expect(p.next!.docs).toBe('/docs/sales-detective');
    expect(p.strategyApproved).toBe(false);

    // Step 1: the Detective produces a named profile (fixture product).
    await saveProfileVersion({
      workspaceId, projectId,
      profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
    });
    p = await onboardingProgress(workspaceId, projectId);
    expect(p.steps[0]!.done).toBe(true);
    expect(p.next!.key).toBe('offer');

    // Step 2: offer approved through G0.
    const [offerId] = await saveOfferVariants({
      workspaceId, projectId, variants: [{ schema_version: '1', name: 'Same-day $499' }],
    });
    await selectOffer({ workspaceId, projectId, offerId: offerId! });
    await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
    p = await onboardingProgress(workspaceId, projectId);
    expect(p.steps[1]!.done).toBe(true);
    expect(p.next!.key).toBe('math');

    // Step 3: funnel math passes (G1).
    await recordFunnelMathRun({ workspaceId, projectId, inputs: {}, outputs: {}, pass: true, report: {} });
    p = await onboardingProgress(workspaceId, projectId);
    expect(p.steps[2]!.done).toBe(true);
    expect(p.next!.key).toBe('markets');
    expect(p.next!.hint).toContain('starving-crowd');

    // Step 4: five markets diagnosed and the strategy approved (G2) —
    // the WO-054 acceptance milestone.
    await applyEngineCandidates({
      workspaceId, projectId,
      candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
    });
    for (const m of await listMarkets(workspaceId, projectId)) {
      await applyMarketProfile({
        workspaceId, projectId, marketId: m.id,
        profile: {
          schema_version: '1', rank: m.rank, label: m.label,
          avatar: { age_range: '30-45', identity: 'homeowner', situation: 's' },
          starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
          awareness_stage: 'problem', awareness_justification: 'x',
          sophistication: 2, sophistication_justification: 'x',
          resident_emotion: 'dread', core_desire: 'quiet door',
          objections: ['a', 'b', 'c', 'd', 'e'], voc_corpus_ref: '',
          channels_ranked: ['search'], entry_conversation: 'e',
        },
      });
    }
    await recordG2({ workspaceId, projectId, snapshot: await buildStrategySnapshot(workspaceId, projectId) });

    p = await onboardingProgress(workspaceId, projectId);
    expect(p.strategyApproved).toBe(true); // ← acceptance: guided path reaches approved G2
    expect(p.steps[3]!.done).toBe(true);
    expect(p.steps[3]!.label).toContain('5 diagnosed');
    expect(p.next!.key).toBe('build'); // and the pointer keeps going
    expect(p.next!.href).toBe(`/projects/${projectId}/build`);
  });
});
