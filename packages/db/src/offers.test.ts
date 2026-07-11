import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import {
  closePool,
  gateReports,
  getApprovedOffer,
  getDb,
  listOffers,
  projects,
  recordG0,
  saveOfferEdit,
  saveOfferVariants,
  selectOffer,
  tenantDb,
} from './index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[offers.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(): Promise<{ workspaceId: string; projectId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Offer test' });
  return { workspaceId, projectId };
}

const VARIANT = (n: number) => ({ schema_version: '1', name: `Variant ${n}`, value_stack: [] });

describe('offer store (WO-010 / G0)', () => {
  it('persists forge variants as consecutive versions, none selected', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    await saveOfferVariants({ workspaceId, projectId, variants: [VARIANT(1), VARIANT(2), VARIANT(3)] });
    const rows = await listOffers(workspaceId, projectId);
    expect(rows.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(rows.every((r) => !r.selected && !r.approved)).toBe(true);
  });

  it('selection is exclusive; edits create a new selected version', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const [a, b] = await saveOfferVariants({ workspaceId, projectId, variants: [VARIANT(1), VARIANT(2)] });
    await selectOffer({ workspaceId, projectId, offerId: a! });
    await selectOffer({ workspaceId, projectId, offerId: b! });
    let rows = await listOffers(workspaceId, projectId);
    expect(rows.filter((r) => r.selected).map((r) => r.id)).toEqual([b]);

    const editedId = await saveOfferEdit({
      workspaceId,
      projectId,
      offer: { schema_version: '1', name: 'Edited', value_stack: [] },
    });
    rows = await listOffers(workspaceId, projectId);
    expect(rows.filter((r) => r.selected).map((r) => r.id)).toEqual([editedId]);
    expect(rows.length).toBe(3);
  });

  it('records G0 and gates advancement: fail leaves no approved offer', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const [id] = await saveOfferVariants({ workspaceId, projectId, variants: [VARIANT(1)] });
    await selectOffer({ workspaceId, projectId, offerId: id! });

    await recordG0({
      workspaceId,
      projectId,
      offerId: id!,
      pass: false,
      report: { failures: ['Value stack must exist…'] },
    });
    expect(await getApprovedOffer(workspaceId, projectId)).toBeNull(); // cannot advance

    await recordG0({ workspaceId, projectId, offerId: id!, pass: true, report: { failures: [] } });
    const approved = await getApprovedOffer(workspaceId, projectId);
    expect(approved?.id).toBe(id);

    // Both verdicts recorded as project-level G0 gate reports.
    const reports = await getDb()
      .select()
      .from(gateReports)
      .where(eq(gateReports.projectId, projectId));
    expect(reports.map((r) => [r.gate, r.pass])).toEqual([
      ['G0', false],
      ['G0', true],
    ]);
    expect(reports.every((r) => r.assetId === null)).toBe(true);

    // Project now points at the approved offer.
    const project = await getDb().select().from(projects).where(eq(projects.id, projectId));
    expect(project[0]!.currentOfferId).toBe(id);
  });

  it('refuses G0 on a non-selected offer', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const [a, b] = await saveOfferVariants({ workspaceId, projectId, variants: [VARIANT(1), VARIANT(2)] });
    await selectOffer({ workspaceId, projectId, offerId: a! });
    await expect(
      recordG0({ workspaceId, projectId, offerId: b!, pass: true, report: {} }),
    ).rejects.toThrow(/selected/);
  });

  it('is workspace-scoped end to end', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const [id] = await saveOfferVariants({ workspaceId, projectId, variants: [VARIANT(1)] });
    const intruder = newId();
    expect(await listOffers(intruder, projectId)).toEqual([]);
    await expect(selectOffer({ workspaceId: intruder, projectId, offerId: id! })).rejects.toThrow();
    await expect(
      recordG0({ workspaceId: intruder, projectId, offerId: id!, pass: true, report: {} }),
    ).rejects.toThrow();
  });
});
