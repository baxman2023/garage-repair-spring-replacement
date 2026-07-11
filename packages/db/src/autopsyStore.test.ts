import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, JOB_TYPES, type AutopsyReport } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import {
  createAutopsy,
  getAutopsy,
  getAutopsyByShareToken,
  rebuildFromAutopsy,
  revokeAutopsyShare,
  saveAutopsyReport,
  shareAutopsy,
} from './autopsyStore.js';
import { jobs, projects } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[autopsyStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function fixtureReport(): AutopsyReport {
  const note = { score: 60, note: 'n' };
  return {
    council_scores: {
      schwartz: note, halbert: note, bencivenga: note,
      sugarman: note, kennedy: note, carlton: note,
    },
    persuasion_map: [
      { page: 'landing', beat: 'hook', technique: 'open loop', note: 'lands' },
      { page: 'landing', beat: 'agitation', technique: 'PAS', note: 'thin' },
      { page: 'checkout', beat: 'risk reversal', technique: 'guarantee', note: 'buried' },
    ],
    mismatch: {
      audience_awareness: 'problem', funnel_assumes: 'product',
      sophistication_market: 4, sophistication_copy: 2,
      diagnosis: 'Awareness mismatch bleeds the click.',
    },
    proof_gaps: [{ claim: 'Same-day fix', gap: 'No terms shown.', severity: 'critical' }],
    offer_critique: { strengths: ['free inspection'], weaknesses: ['no urgency'], verdict: 'Real value, no reason to act today.' },
    rewrite_priorities: [
      { rank: 1, target: 'landing headline', why: 'Largest leak.', expected_impact: 'Aligns with traffic.' },
    ],
  };
}

async function completedAutopsy(workspaceId: string): Promise<string> {
  const id = await createAutopsy({
    workspaceId,
    intake: {
      title: 'Rival garage funnel',
      pages: [
        { kind: 'landing', content: 'Garage door stuck? We fix it today for $499.' },
        { kind: 'checkout', content: 'Order: spring replacement, thirty-day guarantee.' },
      ],
    },
  });
  await saveAutopsyReport(workspaceId, id, fixtureReport());
  return id;
}

describe('autopsy store (WO-047)', () => {
  it('public link is read-only, exposes nothing tenant-scoped, and is revocable', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const autopsyId = await completedAutopsy(workspaceId);

    // Not shared yet: no token works.
    expect(await getAutopsyByShareToken(`at_${'0'.repeat(48)}`)).toBeNull();

    const token = await shareAutopsy(workspaceId, autopsyId);
    expect(token).toMatch(/^at_[0-9a-f]{48}$/);
    // Sharing twice returns the same token (stable link).
    expect(await shareAutopsy(workspaceId, autopsyId)).toBe(token);

    const view = await getAutopsyByShareToken(token);
    expect(view).not.toBeNull();
    expect(view!.title).toBe('Rival garage funnel');
    expect(view!.report.rewrite_priorities[0]!.target).toBe('landing headline');
    // Read-only surface: title, report, date — no ids, no workspace, no pages.
    expect(Object.keys(view!).sort()).toEqual(['createdAt', 'report', 'title']);

    // ACCEPTANCE: revoking kills the link immediately.
    await revokeAutopsyShare(workspaceId, autopsyId);
    expect(await getAutopsyByShareToken(token)).toBeNull();
    // …and the autopsy itself is untouched.
    expect((await getAutopsy(workspaceId, autopsyId))!.status).toBe('complete');
  });

  it('sharing an unfinished autopsy is refused', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const id = await createAutopsy({
      workspaceId,
      intake: { title: 'Draft', pages: [{ kind: 'landing', content: 'x' }] },
    });
    await expect(shareAutopsy(workspaceId, id)).rejects.toThrow(/completed/);
  });

  it('rebuild creates a project and pre-fills Sales Detective from the autopsy; idempotent', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    const autopsyId = await completedAutopsy(workspaceId);

    const { projectId, jobId } = await rebuildFromAutopsy({ workspaceId, autopsyId });
    expect(jobId).not.toBeNull();

    const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, projectId));
    expect(project!.name).toBe('Rebuild: Rival garage funnel');

    // The queued job IS the standard Sales Detective intake, fed the funnel + findings.
    const [job] = await getDb().select().from(jobs).where(eq(jobs.id, jobId!));
    expect(job!.type).toBe(JOB_TYPES.intakeExtractProfile);
    const payload = job!.payload as { projectId: string; text: string };
    expect(payload.projectId).toBe(projectId);
    expect(payload.text).toContain('Garage door stuck?');
    expect(payload.text).toContain('## AUTOPSY FINDINGS');
    expect(payload.text).toContain('1. landing headline');

    // Second click: same project, no duplicate job.
    const again = await rebuildFromAutopsy({ workspaceId, autopsyId });
    expect(again).toEqual({ projectId, jobId: null });
  });
});
