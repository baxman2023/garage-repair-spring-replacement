import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, parseProductProfile } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  getCurrentProfile,
  getDb,
  tenantDb,
  projects,
  type ClaimedJob,
} from '@copyforge/db';
import { createIntakeHandler, INTAKE_EXTRACT_JOB } from './intake.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[intake.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const EXTRACTED = {
  schema_version: '1',
  name: 'SpringGuard Pro',
  category: 'home services',
  promise: 'Never get stranded by a snapped garage spring again',
  mechanism: {
    problem_mechanism: 'springs fatigue invisibly under daily cycles',
    solution_mechanism: 'high-cycle oil-tempered coils rated 3x longer',
    name: 'TripleCycle Coil',
  },
  origin_story: 'Founded after a spring snapped on the owner',
  founder_voice_samples: ['I fix doors the way my dad taught me.'],
  proof_assets: [{ type: 'statistic', ref: '10,000-cycle rating', strength: 'strong' }],
  enemy: 'cut-rate installers using standard-cycle springs',
  price: { amount: 349, model: 'one-time' },
  guarantees: ['5-year workmanship warranty'],
  constraints: { compliance_mode: 'none', banned_claims: [] },
  prior_attempts: [],
  links: [],
};

/**
 * Handler-level job fixture. Queue claim/ack mechanics are covered by
 * queue.test.ts / worker.test.ts; constructing the ClaimedJob directly keeps
 * these tests isolated from the shared jobs table.
 */
function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return {
    id: newId(),
    workspaceId,
    type: INTAKE_EXTRACT_JOB,
    payload,
    attempts: 1,
    jobRunId: newId(),
  };
}

async function setupProject(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-intake-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Intake test' });
  return { workspaceId, projectId };
}

describe('Sales Detective intake (worker job)', () => {
  it('dump mode: paste text → contract-valid versioned profile', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupProject();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(EXTRACTED));
    const handler = createIntakeHandler({ clientOptions: { transport: mock } });

    const job = makeJob(workspaceId, { projectId, text: 'Big sales page dump about garage springs…' });
    expect(job.type).toBe(INTAKE_EXTRACT_JOB);
    await handler(job);

    const saved = await getCurrentProfile(workspaceId, projectId);
    expect(saved).not.toBeNull();
    const profile = parseProductProfile(saved!.profile); // contract-valid
    expect(profile.name).toBe('SpringGuard Pro');
    expect(profile.price.amount).toBe(349);
    expect(saved!.version).toBe(1);
    // The dump text reached the model with the seeded prompt cached.
    expect(mock.calls[0].req.system?.[0]?.cache).toBe(true);
    expect(mock.calls[0].req.messages[0].content).toContain('garage springs');
  });

  it('URL mode: worker fetches, readability-extracts, then extracts profile', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupProject();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(EXTRACTED));
    const fetched: string[] = [];
    const handler = createIntakeHandler({
      clientOptions: { transport: mock },
      fetcher: async (url) => {
        fetched.push(url);
        return `<html><head><title>SpringGuard</title></head><body>
          <script>tracking()</script><h1>Never replace twice</h1>
          <p>Rated ten thousand cycles.</p></body></html>`;
      },
    });

    await handler(makeJob(workspaceId, { projectId, url: 'https://example.com/sales' }));

    expect(fetched).toEqual(['https://example.com/sales']);
    const sent = mock.calls[0].req.messages[0].content;
    expect(sent).toContain('Never replace twice');
    expect(sent).toContain('Rated ten thousand cycles.');
    expect(sent).not.toContain('tracking()');

    const saved = await getCurrentProfile(workspaceId, projectId);
    const profile = parseProductProfile(saved!.profile);
    expect(profile.links).toContain('https://example.com/sales'); // source recorded
  });

  it('second dump merges into a new version without clobbering', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupProject();
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(EXTRACTED));
    mock.pushText(
      JSON.stringify({
        ...EXTRACTED,
        name: '',
        guarantees: ['5-year workmanship warranty', 'free tune-up'],
        origin_story: '',
      }),
    );
    const handler = createIntakeHandler({ clientOptions: { transport: mock } });

    for (const text of ['dump one', 'dump two']) {
      await handler(makeJob(workspaceId, { projectId, text }));
    }

    const saved = await getCurrentProfile(workspaceId, projectId);
    expect(saved!.version).toBe(2);
    const profile = parseProductProfile(saved!.profile);
    expect(profile.name).toBe('SpringGuard Pro'); // empty new value didn't clobber
    expect(profile.guarantees).toEqual(['5-year workmanship warranty', 'free tune-up']);
  });

  it('rejects a model response that is not contract-valid', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setupProject();
    const mock = new MockTransport();
    mock.pushText('{"price": {"amount": "expensive"}}');
    const handler = createIntakeHandler({ clientOptions: { transport: mock } });

    await expect(handler(makeJob(workspaceId, { projectId, text: 'x' }))).rejects.toThrow();
    expect(await getCurrentProfile(workspaceId, projectId)).toBeNull(); // nothing saved
  });
});
