import { desc, eq } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { withTxRetry } from './txRetry.js';
import { gateReports, offers, projects } from './schema/index.js';

/**
 * Offer store (WO-010 / G0). Offers are immutable versions per project;
 * exactly one may be `selected`; approval (G0) is recorded on the offer row
 * AND as a project-level gate report, and sets `projects.current_offer_id`.
 * The G0 checklist itself is pure core logic — callers pass its verdict in.
 */

export type OfferRow = typeof offers.$inferSelect;

async function assertProjectInWorkspace(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const rows = await tx
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!rows[0] || rows[0].workspaceId !== workspaceId) {
    throw new Error('Project not found in this workspace.');
  }
}

export async function listOffers(workspaceId: string, projectId: string): Promise<OfferRow[]> {
  const rows = await getDb()
    .select()
    .from(offers)
    .where(eq(offers.projectId, projectId))
    .orderBy(desc(offers.version));
  return rows.filter((r) => r.workspaceId === workspaceId);
}

/** Persist a batch of forge variants as consecutive versions (none selected). */
export async function saveOfferVariants(params: {
  workspaceId: string;
  projectId: string;
  variants: Record<string, unknown>[];
  createdByUserId?: string | null;
}): Promise<string[]> {
  const db = getDb();
  return withTxRetry(() => db.transaction(async (tx) => {
    await assertProjectInWorkspace(tx, params.workspaceId, params.projectId);
    // No FOR UPDATE — see profiles.ts: empty-range gap locks deadlock; the
    // unique (project_id, version) index + withTxRetry handle races.
    const latest = await tx
      .select({ version: offers.version })
      .from(offers)
      .where(eq(offers.projectId, params.projectId))
      .orderBy(desc(offers.version))
      .limit(1);
    let version = latest[0]?.version ?? 0;
    const ids: string[] = [];
    for (const variant of params.variants) {
      version += 1;
      const id = newId();
      ids.push(id);
      await tx.insert(offers).values({
        id,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        version,
        schemaVersion: '1',
        offer: variant,
        approved: false,
        selected: false,
        createdByUserId: params.createdByUserId ?? null,
      });
    }
    return ids;
  }));
}

/** Mark one offer selected (deselecting siblings). */
export async function selectOffer(params: {
  workspaceId: string;
  projectId: string;
  offerId: string;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await assertProjectInWorkspace(tx, params.workspaceId, params.projectId);
    const row = await tx
      .select({ id: offers.id, workspaceId: offers.workspaceId, projectId: offers.projectId })
      .from(offers)
      .where(eq(offers.id, params.offerId))
      .limit(1);
    if (!row[0] || row[0].workspaceId !== params.workspaceId || row[0].projectId !== params.projectId) {
      throw new Error('Offer not found in this project.');
    }
    await tx.update(offers).set({ selected: false }).where(eq(offers.projectId, params.projectId));
    await tx.update(offers).set({ selected: true }).where(eq(offers.id, params.offerId));
  });
}

/** Save an edited offer as a new selected (unapproved) version. */
export async function saveOfferEdit(params: {
  workspaceId: string;
  projectId: string;
  offer: Record<string, unknown>;
  createdByUserId?: string | null;
}): Promise<string> {
  const [id] = await saveOfferVariants({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    variants: [params.offer],
    createdByUserId: params.createdByUserId,
  });
  await selectOffer({ workspaceId: params.workspaceId, projectId: params.projectId, offerId: id! });
  return id!;
}

/**
 * Record the G0 verdict for the selected offer. On pass: mark approved, point
 * the project at it. Always writes a project-level gate report. Fails closed
 * if the offer isn't the selected one.
 */
export async function recordG0(params: {
  workspaceId: string;
  projectId: string;
  offerId: string;
  pass: boolean;
  report: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await assertProjectInWorkspace(tx, params.workspaceId, params.projectId);
    const row = await tx
      .select({
        id: offers.id,
        workspaceId: offers.workspaceId,
        projectId: offers.projectId,
        selected: offers.selected,
      })
      .from(offers)
      .where(eq(offers.id, params.offerId))
      .limit(1);
    const offer = row[0];
    if (!offer || offer.workspaceId !== params.workspaceId || offer.projectId !== params.projectId) {
      throw new Error('Offer not found in this project.');
    }
    if (!offer.selected) throw new Error('Only the selected offer can go through G0.');

    await tx.insert(gateReports).values({
      id: newId(),
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      assetId: null,
      gate: 'G0',
      pass: params.pass,
      report: params.report,
    });

    if (params.pass) {
      await tx.update(offers).set({ approved: true }).where(eq(offers.id, params.offerId));
      await tx
        .update(projects)
        .set({ currentOfferId: params.offerId })
        .where(eq(projects.id, params.projectId));
    }
  });
}

/** The approved offer for a project, or null — later gates require it. */
export async function getApprovedOffer(
  workspaceId: string,
  projectId: string,
): Promise<OfferRow | null> {
  const rows = await getDb()
    .select()
    .from(offers)
    .where(eq(offers.projectId, projectId))
    .orderBy(desc(offers.version));
  return rows.find((r) => r.workspaceId === workspaceId && r.approved && r.selected) ?? null;
}
