import { z } from 'zod';
import {
  deleteWorkspaceKey,
  getWorkspaceKeyMeta,
  storeWorkspaceKey,
  testWorkspaceKey,
} from '@copyforge/ai';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';

export const apiKeyRouter = router({
  /** Whether a key is configured + its last4 / verification state. */
  status: workspaceProcedure.query(({ ctx }) => getWorkspaceKeyMeta(ctx.workspaceId)),

  /** Store or rotate the workspace's Anthropic key (owners only). */
  set: ownerProcedure
    .input(z.object({ key: z.string().min(20, 'That does not look like an API key.') }))
    .mutation(async ({ ctx, input }) => {
      const { last4 } = await storeWorkspaceKey(ctx.workspaceId, input.key.trim());
      return { ok: true as const, last4 };
    }),

  /** Verify the stored key with a 1-token ping (owners only). */
  test: ownerProcedure.mutation(({ ctx }) => testWorkspaceKey(ctx.workspaceId)),

  /** Remove the stored key (owners only). */
  remove: ownerProcedure.mutation(async ({ ctx }) => {
    await deleteWorkspaceKey(ctx.workspaceId);
    return { ok: true as const };
  }),
});
