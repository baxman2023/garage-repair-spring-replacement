import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  assertG1Passed,
  closePool,
  enqueueGenerationJob,
  gateReports,
  getDb,
  jobs,
  latestFunnelMathRun,
  projects,
  recordFunnelMathRun,
  tenantDb,
} from './index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[funnelMath.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Math test' });
  return { workspaceId, projectId };
}

describe('funnel math persistence + G1 hard stop (WO-011)', () => {
  it('blocks generation before any run, after a failing run, allows after a pass', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const gen = () =>
      enqueueGenerationJob({ workspaceId, projectId, type: 'market.select', payload: { projectId } });

    // No run yet → hard stop.
    await expect(gen()).rejects.toThrow(/G1 hard stop/);

    // Failing run → still blocked.
    await recordFunnelMathRun({
      workspaceId,
      projectId,
      inputs: { price: 100 },
      outputs: { allowableCpa: 40 },
      pass: false,
      report: { fixes: ['raise price'] },
    });
    await expect(gen()).rejects.toThrow(/failed/);
    await expect(assertG1Passed(workspaceId, projectId)).rejects.toThrow();

    // Passing run → generation flows.
    await recordFunnelMathRun({
      workspaceId,
      projectId,
      inputs: { price: 1000 },
      outputs: { allowableCpa: 720 },
      pass: true,
      report: {},
    });
    const jobId = await gen();
    const row = await getDb().select().from(jobs).where(eq(jobs.id, jobId));
    expect(row[0]?.type).toBe('market.select');

    // Latest run wins; both G1 verdicts recorded as project gate reports.
    expect((await latestFunnelMathRun(workspaceId, projectId))?.pass).toBe(true);
    const reports = await getDb()
      .select()
      .from(gateReports)
      .where(eq(gateReports.projectId, projectId));
    expect(reports.filter((r) => r.gate === 'G1').map((r) => r.pass)).toEqual([false, true]);
  });

  it('a later failing run re-arms the hard stop', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    await recordFunnelMathRun({
      workspaceId, projectId, inputs: {}, outputs: {}, pass: true, report: {},
    });
    await assertG1Passed(workspaceId, projectId); // passes
    await recordFunnelMathRun({
      workspaceId, projectId, inputs: {}, outputs: {}, pass: false, report: {},
    });
    await expect(assertG1Passed(workspaceId, projectId)).rejects.toThrow(/failed/);
  });

  it('is workspace-scoped', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    await expect(
      recordFunnelMathRun({
        workspaceId: newId(),
        projectId,
        inputs: {},
        outputs: {},
        pass: true,
        report: {},
      }),
    ).rejects.toThrow();
    await recordFunnelMathRun({ workspaceId, projectId, inputs: {}, outputs: {}, pass: true, report: {} });
    expect(await latestFunnelMathRun(newId(), projectId)).toBeNull();
  });
});
