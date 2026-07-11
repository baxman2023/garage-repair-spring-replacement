import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, totalDurationSeconds, wordCount, type AssetBlock, type Offer } from '@copyforge/core';
import { MockTransport, storeWorkspaceKey } from '@copyforge/ai';
import {
  applyEngineCandidates,
  applyMarketProfile,
  closePool,
  getCurrentAssetVersion,
  getDb,
  listMarkets,
  projects,
  recordG0,
  saveOfferVariants,
  saveProfileVersion,
  selectOffer,
  tenantDb,
  assets as assetsTable,
  type ClaimedJob,
} from '@copyforge/db';
import { ASSET_GENERATE_JOB, createGenerateHandler } from './generate.js';
import { assertSkeletonOrder, assertStackMirrorsOffer, WEBINAR_SECTIONS } from './generators/webinar.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[webinar.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_v, i) => `${seed}${'abcdefghijklmnopqrstuvwxyz'[i % 26]}`).join(' ');

const OFFER = {
  schema_version: '1',
  name: 'Spring Rescue Blueprint',
  value_stack: [
    { item: 'Torsion Masterclass', value_usd: 500, justification: 'core training' },
    { item: 'Emergency Release Guide', value_usd: 97, justification: 'bonus' },
  ],
  risk_reversal: 'Full refund inside thirty days',
  urgency_mechanisms: [
    { type: 'deadline', description: 'Enrollment closes Friday', legitimacy_basis: 'cohort starts Monday' },
  ],
  price_framing: 'Less than one emergency service call',
  price: { amount: 297, model: 'one-time' },
};

/** Contract-valid presentation: all six skeleton sections in order; the stack
 * carries the offer items with dollar figures for the spoken post-processor. */
const presentation = () => [
  { id: 'domino', role: 'hook', text: `If garage doors fail from cycle fatigue and not age, then everything changes. ${words(60, 'd')}`, meta: { section: 'big_domino' } },
  { id: 'domino-setup', role: 'lead', text: words(80, 'e'), meta: { section: 'big_domino' } },
  { id: 's1', role: 'story', text: `Secret one. The vehicle works. ${words(90, 'v')}`, meta: { section: 'secret_vehicle' } },
  { id: 's2', role: 'story', text: `Secret two. You can do this. ${words(90, 'i')}`, meta: { section: 'secret_internal' } },
  { id: 's3', role: 'story', text: `Secret three. Nothing outside stops you. ${words(90, 'x')}`, meta: { section: 'secret_external' } },
  { id: 'stack', role: 'offer', text: `First the Torsion Masterclass worth $500. Then the Emergency Release Guide worth $97. ${words(60, 's')}`, meta: { section: 'stack' } },
  { id: 'close', role: 'close', text: `Enrollment closes Friday. Click the button below. ${words(60, 'c')}`, meta: { section: 'close' } },
];

const registration = () => [
  { id: 'reg-headline', role: 'headline', text: 'Free training: why springs really snap' },
  { id: 'reg-bullets', role: 'bullets', text: 'The cycle-fatigue truth. The self-check. The fix.' },
];

const emails = () => [
  { kind: 'reminder_24h', subject: 'Tomorrow: the spring truth', body: 'We go live tomorrow. Save your seat: {{webinar_link}}' },
  { kind: 'reminder_1h', subject: 'One hour out', body: 'Doors open in an hour: {{webinar_link}}' },
  { kind: 'reminder_15m', subject: 'Starting now', body: 'We start in fifteen minutes: {{webinar_link}}' },
  { kind: 'replay', subject: 'Replay is up (briefly)', body: 'The replay comes down when enrollment closes Friday: {{webinar_link}}' },
];

const webinarPayload = (over: Partial<{ presentation: unknown[]; registration: unknown[]; emails: unknown[] }> = {}) =>
  JSON.stringify({
    presentation: { blocks: over.presentation ?? presentation() },
    registration: { blocks: over.registration ?? registration() },
    emails: over.emails ?? emails(),
  });

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  await storeWorkspaceKey(workspaceId, 'sk-ant-web-test-000000');
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Webinar test' });
  await saveProfileVersion({
    workspaceId,
    projectId,
    profile: { schema_version: '1', name: 'SpringGuard', category: 'garage-repair' },
  });
  const [offerId] = await saveOfferVariants({ workspaceId, projectId, variants: [OFFER] });
  await selectOffer({ workspaceId, projectId, offerId: offerId! });
  await recordG0({ workspaceId, projectId, offerId: offerId!, pass: true, report: {} });
  await applyEngineCandidates({
    workspaceId,
    projectId,
    candidates: Array.from({ length: 8 }, (_v, i) => ({ label: `M${i}`, rationale: 'r', total: 70, profile: {} })),
  });
  const markets = await listMarkets(workspaceId, projectId);
  const marketId = markets[0]!.id;
  await applyMarketProfile({
    workspaceId,
    projectId,
    marketId,
    profile: {
      schema_version: '1',
      rank: 1,
      label: markets[0]!.label,
      avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
      starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
      awareness_stage: 'problem',
      awareness_justification: 'daily symptom',
      sophistication: 2,
      sophistication_justification: 'low',
      resident_emotion: 'dread',
      core_desire: 'forget the door',
      objections: ['a', 'b', 'c', 'd', 'e'],
      voc_corpus_ref: '',
      channels_ranked: ['search'],
      entry_conversation: 'Is this going to snap?',
    },
  });
  return { workspaceId, projectId, marketId };
}

function makeJob(workspaceId: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type: ASSET_GENERATE_JOB, payload, attempts: 1, jobRunId: newId() };
}

describe('webinar skeleton assertions (pure)', () => {
  const meta = (section: string) => ({ section });
  const block = (id: string, section: string): AssetBlock => ({ id, role: 'story', text: 'x', meta: meta(section) });

  it('accepts all sections in order, rejects a missing or misordered section', () => {
    const ordered = WEBINAR_SECTIONS.map((s, i) => block(`b${i}`, s));
    expect(() => assertSkeletonOrder(ordered)).not.toThrow();
    expect(() => assertSkeletonOrder(ordered.slice(1))).toThrow(/missing section "big_domino"/);
    const swapped = [...ordered];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(() => assertSkeletonOrder(swapped)).toThrow(/must come after/);
  });

  it('stack must mirror the offer items and spoken values', () => {
    const offer = { value_stack: OFFER.value_stack } as Offer;
    const good: AssetBlock[] = [
      { id: 'stack', role: 'offer', text: 'the torsion masterclass worth five hundred dollars, the emergency release guide worth ninety-seven dollars', meta: meta('stack') },
    ];
    expect(() => assertStackMirrorsOffer(good, offer)).not.toThrow();
    const missingItem: AssetBlock[] = [
      { id: 'stack', role: 'offer', text: 'the torsion masterclass worth five hundred dollars', meta: meta('stack') },
    ];
    expect(() => assertStackMirrorsOffer(missingItem, offer)).toThrow(/Emergency Release Guide/);
    const missingValue: AssetBlock[] = [
      { id: 'stack', role: 'offer', text: 'the torsion masterclass and the emergency release guide, worth five hundred dollars together', meta: meta('stack') },
    ];
    expect(() => assertStackMirrorsOffer(missingValue, offer)).toThrow(/ninety-seven/);
  });
});

describe('webinar generator (WO-025)', () => {
  it('persists the full package: ordered skeleton, mirrored stack, registration, 4 emails, timestamps', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    mock.pushText(webinarPayload());
    mock.pushText(JSON.stringify({ claims: [{ text: 'rated ten thousand cycles', proof_ref: '' }] }));

    await createGenerateHandler({ transport: mock })(
      makeJob(workspaceId, { projectId, marketId, assetType: 'webinar' }),
    );

    const assetRows = await tenantDb(workspaceId).findMany(assetsTable, undefined);
    const asset = assetRows.find((a) => a.type === 'webinar')!;
    expect(asset).toBeDefined();
    const version = (await getCurrentAssetVersion(workspaceId, asset.id))!;
    const blocks = version.blocks as AssetBlock[];

    // Skeleton: all six sections present, in order, at the head of the asset.
    const sectionOf = (b: AssetBlock) => (b.meta as { section?: string }).section;
    const presentationBlocks = blocks.filter((b) => (WEBINAR_SECTIONS as readonly string[]).includes(sectionOf(b) ?? ''));
    expect(new Set(presentationBlocks.map(sectionOf))).toEqual(new Set(WEBINAR_SECTIONS));
    expect(() => assertSkeletonOrder(presentationBlocks)).not.toThrow();

    // Spoken conventions + stack mirror: $500/$97 became words in stored text.
    const stack = blocks.find((b) => sectionOf(b) === 'stack')!;
    expect(stack.text).toContain('five hundred dollars');
    expect(stack.text).toContain('ninety-seven dollars');
    expect(stack.text).not.toMatch(/\d/);

    // 170-WPM timestamps on the presentation, sequential and within ±5%.
    let prevEnd = 0;
    for (const b of presentationBlocks) {
      expect(b.meta!.timestampStart).toBeCloseTo(prevEnd, 0);
      prevEnd = b.meta!.timestampEnd as number;
    }
    const totalWords = wordCount(presentationBlocks.map((b) => b.text).join(' '));
    const expected = (totalWords / 170) * 60;
    expect(Math.abs(totalDurationSeconds(presentationBlocks) - expected) / expected).toBeLessThan(0.05);

    // Registration copy present, tagged, and NOT timestamped (written page copy).
    const reg = blocks.filter((b) => sectionOf(b) === 'registration');
    expect(reg.length).toBeGreaterThanOrEqual(2);
    expect(reg[0]!.meta!.timestampStart).toBeUndefined();

    // Four emails, each with a subject and body block.
    for (const kind of ['reminder_24h', 'reminder_1h', 'reminder_15m', 'replay']) {
      const emailBlocks = blocks.filter((b) => sectionOf(b) === `email_${kind}`);
      expect(emailBlocks.map((b) => b.role).sort()).toEqual(['body', 'subject']);
    }
    expect((version.meta as { emails: string[] }).emails).toHaveLength(4);

    // Claims inventory + auto-G3 council enqueue.
    const { jobs, claims: claimsTable } = await import('@copyforge/db');
    const storedClaims = await tenantDb(workspaceId).findMany(claimsTable, undefined);
    expect(storedClaims.length).toBe(1);
    const queued = await getDb().select().from(jobs);
    expect(queued.some((j) => j.type === 'asset.council' && (j.payload as { assetId: string }).assetId === asset.id)).toBe(true);
  });

  it('rejects a presentation with a misordered skeleton', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const shuffled = presentation();
    // Move the stack before the secrets.
    const stack = shuffled.splice(5, 1)[0]!;
    shuffled.splice(2, 0, stack);
    const mock = new MockTransport();
    mock.pushText(webinarPayload({ presentation: shuffled }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'webinar' })),
    ).rejects.toThrow(/must come after/);
  });

  it('rejects a stack that does not mirror the offer line-for-line', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const blocks = presentation();
    blocks[5] = { ...blocks[5]!, text: `First the Torsion Masterclass worth $500. ${words(60, 's')}` };
    const mock = new MockTransport();
    mock.pushText(webinarPayload({ presentation: blocks }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'webinar' })),
    ).rejects.toThrow(/Emergency Release Guide/);
  });

  it('rejects a package missing an email kind', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const mock = new MockTransport();
    mock.pushText(webinarPayload({ emails: emails().slice(0, 3) }));
    await expect(
      createGenerateHandler({ transport: mock })(makeJob(workspaceId, { projectId, marketId, assetType: 'webinar' })),
    ).rejects.toThrow();
  });
});
