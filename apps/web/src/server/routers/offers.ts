import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { checkG0, JOB_TYPES, parseOffer } from '@copyforge/core';
import {
  enqueueJob,
  getApprovedOffer,
  getCurrentProfile,
  listOffers,
  projects,
  recordG0,
  saveOfferEdit,
  selectOffer,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

/** Offer Forge + G0 (WO-010). */
export const offersRouter = router({
  /** All offer versions with parsed bodies + per-offer G0 checklist preview. */
  list: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const rows = await listOffers(ctx.workspaceId, input.projectId);
    return rows.map((r) => {
      const offer = parseOffer(r.offer);
      return {
        id: r.id,
        version: r.version,
        selected: r.selected,
        approved: r.approved,
        offer,
        g0: checkG0(offer),
      };
    });
  }),

  /** Queue the fable-5 forge pass (requires an intake profile). */
  forge: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const profile = await getCurrentProfile(ctx.workspaceId, input.projectId);
    if (!profile) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Run Sales Detective intake first — the forge needs a product profile.',
      });
    }
    const jobId = await enqueueJob({
      workspaceId: ctx.workspaceId,
      type: JOB_TYPES.offerForge,
      payload: { projectId: input.projectId },
    });
    return { jobId };
  }),

  /** Pick one variant. */
  select: workspaceProcedure
    .input(projectScoped.extend({ offerId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await selectOffer({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        offerId: input.offerId,
      });
      return { ok: true as const };
    }),

  /** Save an edited offer (contract-validated) as a new selected version. */
  saveEdit: workspaceProcedure
    .input(projectScoped.extend({ offer: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      let offer;
      try {
        offer = parseOffer(input.offer);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            err instanceof Error
              ? `Offer does not match the contract: ${err.message}`
              : 'Offer does not match the contract.',
        });
      }
      const id = await saveOfferEdit({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        offer,
        createdByUserId: ctx.auth.user.id,
      });
      return { id };
    }),

  /**
   * G0: run the checklist on the selected offer and record the verdict. The
   * pipeline cannot advance unless this passes — a failing offer is refused
   * (recorded as a failing gate report) and stays unapproved.
   */
  approve: workspaceProcedure
    .input(projectScoped.extend({ offerId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const rows = await listOffers(ctx.workspaceId, input.projectId);
      const row = rows.find((r) => r.id === input.offerId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Offer not found.' });
      const report = checkG0(parseOffer(row.offer));
      await recordG0({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        offerId: input.offerId,
        pass: report.pass,
        report: report as unknown as Record<string, unknown>,
      });
      if (!report.pass) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `G0 failed: ${report.failures.join(' ')}`,
        });
      }
      return { ok: true as const };
    }),

  /** The approved offer gate status (used to block advancement). */
  status: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const approved = await getApprovedOffer(ctx.workspaceId, input.projectId);
    return { approvedOfferId: approved?.id ?? null };
  }),
});
