import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  applyIntakeAnswer,
  emptyProductProfile,
  JOB_TYPES,
  parseProductProfile,
  unansweredProfileFields,
} from '@copyforge/core';
import {
  enqueueJob,
  getCurrentProfile,
  projects,
  saveProfileVersion,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

/** Sales Detective intake (WO-009): dump mode + interrogation + editor saves. */
export const intakeRouter = router({
  /** Current profile (contract-parsed) + version, or an empty draft. */
  profile: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const row = await getCurrentProfile(ctx.workspaceId, input.projectId);
    return {
      version: row?.version ?? 0,
      profile: row ? parseProductProfile(row.profile) : emptyProductProfile(),
      updatedAt: row?.updatedAt ?? null,
    };
  }),

  /** Dump mode: paste text (file uploads are read client-side into text). */
  dumpText: workspaceProcedure
    .input(projectScoped.extend({ text: z.string().min(1).max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const jobId = await enqueueJob({
        workspaceId: ctx.workspaceId,
        type: JOB_TYPES.intakeExtractProfile,
        payload: { projectId: input.projectId, text: input.text },
      });
      return { jobId };
    }),

  /** Dump mode: URL — fetched + readability-extracted by the worker. */
  dumpUrl: workspaceProcedure
    .input(projectScoped.extend({ url: z.string().url().max(2048) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const jobId = await enqueueJob({
        workspaceId: ctx.workspaceId,
        type: JOB_TYPES.intakeExtractProfile,
        payload: { projectId: input.projectId, url: input.url },
      });
      return { jobId };
    }),

  /**
   * Interrogation: the questions still unanswered. `answered` carries the
   * fields explicitly answered this interview (needed to retire fields whose
   * legitimate answer equals the contract default, e.g. compliance "none").
   */
  questions: workspaceProcedure
    .input(projectScoped.extend({ answered: z.array(z.string()).default([]) }))
    .query(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const row = await getCurrentProfile(ctx.workspaceId, input.projectId);
      const profile = row ? parseProductProfile(row.profile) : emptyProductProfile();
      return unansweredProfileFields(profile, new Set(input.answered));
    }),

  /** Interrogation: apply one answer and save a new profile version. */
  answer: workspaceProcedure
    .input(projectScoped.extend({ field: z.string().min(1), answer: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const row = await getCurrentProfile(ctx.workspaceId, input.projectId);
      const base = row ? parseProductProfile(row.profile) : emptyProductProfile();
      let next;
      try {
        next = applyIntakeAnswer(base, input.field, input.answer);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Invalid answer.',
        });
      }
      await saveProfileVersion({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        profile: next,
        createdByUserId: ctx.auth.user.id,
      });
      return { ok: true as const };
    }),

  /** Editor: save a full (contract-validated) profile as a new version. */
  saveProfile: workspaceProcedure
    .input(projectScoped.extend({ profile: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      let profile;
      try {
        profile = parseProductProfile(input.profile);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Profile does not match the product_profile contract.',
        });
      }
      await saveProfileVersion({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        profile,
        createdByUserId: ctx.auth.user.id,
      });
      return { ok: true as const };
    }),
});
