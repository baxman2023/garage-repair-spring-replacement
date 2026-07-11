import { z } from 'zod';
import { lineDiff } from '@copyforge/core';
import {
  activatePromptVersion,
  createPromptVersion,
  getPromptById,
  listPromptNames,
  listPromptVersions,
} from '@copyforge/db';
import { adminProcedure, router } from '../trpc';

/** Prompt registry management — admin only (WO-008). */
export const promptsRouter = router({
  names: adminProcedure.query(() => listPromptNames()),

  versions: adminProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ input }) => listPromptVersions(input.name)),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        body: z.string().min(1),
        description: z.string().optional(),
        activate: z.boolean().default(true),
      }),
    )
    .mutation(({ input }) => createPromptVersion(input)),

  activate: adminProcedure
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ input }) => {
      await activatePromptVersion(input.id);
      return { ok: true as const };
    }),

  diff: adminProcedure
    .input(z.object({ aId: z.string().length(26), bId: z.string().length(26) }))
    .query(async ({ input }) => {
      const [a, b] = await Promise.all([getPromptById(input.aId), getPromptById(input.bId)]);
      if (!a || !b) throw new Error('One or both prompt versions were not found.');
      return {
        a: { version: a.version },
        b: { version: b.version },
        ops: lineDiff(a.body, b.body),
      };
    }),
});
