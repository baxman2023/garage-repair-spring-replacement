import { z } from 'zod';
import { JOB_TYPES } from '@copyforge/core';
import {
  adminListModelRoutes,
  adminSearchLicenses,
  adminSearchUsers,
  adminSearchWorkspaces,
  adminUpdateModelRoute,
  adminUsageOverview,
  getEffectivePausedJobTypes,
  issueLicense,
  listFlags,
  revokeLicense,
  setFlag,
  setPausedJobTypes,
} from '@copyforge/db';
import { adminProcedure, router } from '../trpc';

/**
 * Platform admin surface (WO-052). Every procedure sits behind adminProcedure
 * (isPlatformAdmin) — workspace owners get FORBIDDEN here. Prompt registry
 * management already lives in the prompts router (also admin-guarded).
 */

const KNOWN_JOB_TYPES = Object.values(JOB_TYPES) as string[];

export const adminRouter = router({
  search: adminProcedure
    .input(z.object({ query: z.string().trim().min(1).max(255) }))
    .query(async ({ input }) => {
      const [users, workspaces, licenses] = await Promise.all([
        adminSearchUsers(input.query),
        adminSearchWorkspaces(input.query),
        adminSearchLicenses(input.query),
      ]);
      return { users, workspaces, licenses };
    }),

  issueLicense: adminProcedure
    .input(z.object({
      seats: z.number().int().min(1).max(500),
      type: z.enum(['standard', 'beta']).default('standard'),
      expiresAt: z.date().nullable().optional(),
      workspaceId: z.string().length(26).optional(),
    }))
    .mutation(({ input }) =>
      issueLicense({
        seats: input.seats,
        type: input.type,
        expiresAt: input.expiresAt ?? null,
        workspaceId: input.workspaceId ?? null,
      }),
    ),

  revokeLicense: adminProcedure
    .input(z.object({ licenseId: z.string().length(26) }))
    .mutation(async ({ input }) => {
      await revokeLicense(input.licenseId);
      return { ok: true as const };
    }),

  // --- Flags & kill switches ------------------------------------------------------
  flags: adminProcedure.query(async () => ({
    flags: await listFlags(),
    pausedJobTypes: await getEffectivePausedJobTypes(),
    knownJobTypes: KNOWN_JOB_TYPES,
  })),

  setFlag: adminProcedure
    .input(z.object({ key: z.string().trim().min(1).max(128), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await setFlag(input);
      return { ok: true as const };
    }),

  setPausedJobTypes: adminProcedure
    .input(z.object({ types: z.array(z.string().trim().min(1).max(64)).max(64) }))
    .mutation(async ({ input }) => {
      await setPausedJobTypes(input.types);
      return { ok: true as const };
    }),

  // --- Model routes -----------------------------------------------------------------
  modelRoutes: adminProcedure.query(() => adminListModelRoutes()),

  updateModelRoute: adminProcedure
    .input(z.object({
      routeId: z.string().length(26),
      primaryModel: z.string().trim().min(1).max(128).optional(),
      maxTokens: z.number().int().min(256).max(64_000).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await adminUpdateModelRoute(input);
      return { ok: true as const };
    }),

  // --- Usage overview (never content) ------------------------------------------------
  usage: adminProcedure.query(() => adminUsageOverview()),
});
