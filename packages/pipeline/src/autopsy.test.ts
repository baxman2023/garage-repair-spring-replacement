import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AutopsyReport } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  closePool,
  createAutopsy,
  getAutopsy,
  getDb,
  type ClaimedJob,
} from '@copyforge/db';
import { AUTOPSY_RUN_JOB, createAutopsyRunHandler } from './autopsy.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[autopsy.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

function fixtureReport(): AutopsyReport {
  const note = (score: number, text: string) => ({ score, note: text });
  return {
    council_scores: {
      schwartz: note(62, 'Writes to product-aware; the ad recruits problem-aware.'),
      halbert: note(55, 'Hook buried under the logo.'),
      bencivenga: note(40, 'Same-day claim carries the funnel and has zero proof.'),
      sugarman: note(70, 'Readable; slide stalls at the offer.'),
      kennedy: note(48, 'No deadline anywhere.'),
      carlton: note(66, 'Voice fine, lead limp.'),
    },
    persuasion_map: [
      { page: 'ad', beat: 'curiosity hook', technique: 'open loop', note: 'Promises a secret the landing page never pays off.' },
      { page: 'landing', beat: 'problem agitation', technique: 'PAS', note: 'Two paragraphs then straight to price.' },
      { page: 'vsl_transcript', beat: 'mechanism reveal', technique: 'unique mechanism', note: 'Named, never differentiated.' },
      { page: 'checkout', beat: 'risk reversal', technique: 'guarantee', note: 'Guarantee only in the footer.' },
    ],
    mismatch: {
      audience_awareness: 'problem',
      funnel_assumes: 'product',
      sophistication_market: 4,
      sophistication_copy: 2,
      diagnosis: 'Problem-aware clicks meet a brand-first page; stage-four market, stage-two claims.',
    },
    proof_gaps: [
      { claim: 'Fixed same day or free', gap: 'No terms, no honored-claim count.', severity: 'critical' },
    ],
    offer_critique: {
      strengths: ['Free inspection'],
      weaknesses: ['No urgency device'],
      verdict: 'Real value with no reason to act today.',
    },
    rewrite_priorities: [
      { rank: 1, target: 'landing headline', why: 'Awareness mismatch is the biggest leak.', expected_impact: 'Aligns page with traffic.' },
      { rank: 2, target: 'checkout risk reversal', why: 'Strongest proof asset is hidden.', expected_impact: 'Moves decision to logistics.' },
    ],
  };
}

const makeJob = (workspaceId: string, payload: Record<string, unknown>): ClaimedJob => ({
  id: newId(), workspaceId, type: AUTOPSY_RUN_JOB, payload, attempts: 1, jobRunId: newId(),
});

describe('autopsy teardown job (WO-047 acceptance: end-to-end on a fixture funnel)', () => {
  it('fetches URL pages, runs the Council teardown, persists the contract-valid report', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-autopsy-test-0000');

    const autopsyId = await createAutopsy({
      workspaceId,
      intake: {
        title: 'Rival garage funnel',
        pages: [
          { kind: 'ad', content: 'Is YOUR garage door about to snap? The 6am bang nobody warns you about.' },
          { kind: 'landing', sourceUrl: 'https://example.com/landing' },
          { kind: 'vsl_transcript', content: 'Hi, I am Dale. Let me tell you about torsion springs…' },
          { kind: 'checkout', content: 'Spring replacement — $499. Thirty-day guarantee.' },
        ],
      },
    });

    const mock = new MockTransport();
    mock.pushText(JSON.stringify(fixtureReport()));
    const fetcher = async (url: string) => {
      expect(url).toBe('https://example.com/landing');
      return '<html><head><title>Same-Day Garage Rescue</title></head><body><p>Fixed same day or free. Rated best in the county.</p></body></html>';
    };

    await createAutopsyRunHandler({ clientOptions: { transport: mock }, fetcher })(
      makeJob(workspaceId, { autopsyId }),
    );

    const row = await getAutopsy(workspaceId, autopsyId);
    expect(row!.status).toBe('complete');
    const report = row!.report as unknown as AutopsyReport;
    expect(report.rewrite_priorities.map((p) => p.rank)).toEqual([1, 2]);
    expect(report.persuasion_map).toHaveLength(4);
    expect(report.mismatch.audience_awareness).toBe('problem');
    expect(Object.keys(report.council_scores)).toHaveLength(6);

    // The fetched landing content was persisted back onto the intake…
    const pages = row!.pages as Array<{ kind: string; content?: string }>;
    const landing = pages.find((p) => p.kind === 'landing')!;
    expect(landing.content).toContain('Fixed same day or free');

    // …and the model saw the WHOLE funnel in funnel order.
    const sent = JSON.stringify(mock.calls[0]);
    expect(sent).toContain('about to snap');
    expect(sent).toContain('Fixed same day or free');
    expect(sent).toContain('torsion springs');
    expect(sent).toContain('Thirty-day guarantee');
    expect(sent.indexOf('AD (')).toBeLessThan(sent.indexOf('LANDING PAGE'));
    expect(sent.indexOf('VSL TRANSCRIPT')).toBeLessThan(sent.indexOf('CHECKOUT'));
  });

  it('a contract-breaking teardown fails the job and marks the autopsy failed', async () => {
    if (!dbUp) return;
    const workspaceId = newId();
    await storeWorkspaceKey(workspaceId, 'sk-ant-autopsy-test-0001');
    const autopsyId = await createAutopsy({
      workspaceId,
      intake: { title: 'Broken run', pages: [{ kind: 'landing', content: 'copy' }] },
    });

    const bad = fixtureReport();
    bad.rewrite_priorities = [{ rank: 2, target: 'x', why: 'y', expected_impact: 'z' }]; // no rank 1
    const mock = new MockTransport();
    mock.pushText(JSON.stringify(bad));

    await expect(
      createAutopsyRunHandler({ clientOptions: { transport: mock } })(makeJob(workspaceId, { autopsyId })),
    ).rejects.toThrow(/contiguously/);
    const row = await getAutopsy(workspaceId, autopsyId);
    expect(row!.status).toBe('failed');
    expect(row!.error).toContain('contiguously');
    expect(row!.report).toBeNull();
  });
});
