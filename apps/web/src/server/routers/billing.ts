import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { listReceipts, subscriptionStatus } from '@copyforge/db';
import { createCheckoutSession } from '../billing';
import { ownerProcedure, router, workspaceProcedure } from '../trpc';

/** Billing surface (WO-051): buy seats, buy Genome Feed, see receipts. */

const wrap = <T>(fn: () => Promise<T>): Promise<T> =>
  fn().catch((err) => {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: err instanceof Error ? err.message : 'Billing operation failed.',
    });
  });

export const billingRouter = router({
  receipts: workspaceProcedure.query(({ ctx }) => listReceipts(ctx.workspaceId)),

  subscription: workspaceProcedure.query(({ ctx }) => subscriptionStatus(ctx.workspaceId)),

  /** $1,000/seat lifetime license checkout (quantity = seats). */
  buyLicense: ownerProcedure
    .input(z.object({ seats: z.number().int().min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      wrap(() =>
        createCheckoutSession({ workspaceId: ctx.workspaceId, kind: 'license', seats: input.seats }),
      ),
    ),

  /** Genome Feed $79/mo subscription checkout. */
  buyGenomeFeed: ownerProcedure.mutation(({ ctx }) =>
    wrap(() => createCheckoutSession({ workspaceId: ctx.workspaceId, kind: 'genome_feed' })),
  ),
});
