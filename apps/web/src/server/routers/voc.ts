import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { JOB_TYPES } from '@copyforge/core';
import {
  addVocSource,
  enqueueGenerationJob,
  listMarketPhrases,
  listVocSources,
  markets,
  projects,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

const projectScoped = z.object({ projectId: z.string().length(26) });
const marketScoped = projectScoped.extend({ marketId: z.string().length(26) });

async function assertMarket(db: TenantDb, projectId: string, marketId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
  const market = await db.findFirst(markets, eq(markets.id, marketId));
  if (!market || market.projectId !== projectId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Market not found in this project.' });
  }
}

/** VOC miner (WO-014). */
export const vocRouter = router({
  /** Add a source (paste blob or URL) and queue mining. */
  addSource: workspaceProcedure
    .input(
      marketScoped.extend({
        kind: z.enum(['paste', 'url']),
        content: z.string().max(500_000).optional(),
        url: z.string().url().max(2048).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMarket(ctx.db, input.projectId, input.marketId);
      if (input.kind === 'paste' && !input.content?.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Paste sources need content.' });
      }
      if (input.kind === 'url' && !input.url) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'URL sources need a URL.' });
      }
      const sourceId = await addVocSource({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        marketId: input.marketId,
        kind: input.kind,
        ref: input.url,
        rawContent: input.content,
      });
      try {
        const jobId = await enqueueGenerationJob({
          workspaceId: ctx.workspaceId,
          projectId: input.projectId,
          type: JOB_TYPES.vocMine,
          payload: { projectId: input.projectId, sourceId },
        });
        return { sourceId, jobId };
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : 'G1 hard stop.',
        });
      }
    }),

  /** Per-market corpus, grouped client-side. */
  corpus: workspaceProcedure.input(marketScoped).query(async ({ ctx, input }) => {
    await assertMarket(ctx.db, input.projectId, input.marketId);
    const [phrases, sources] = await Promise.all([
      listMarketPhrases(ctx.workspaceId, input.marketId),
      listVocSources(ctx.workspaceId, input.marketId),
    ]);
    return {
      phrases: phrases.map((p) => ({
        id: p.id,
        phrase: p.phrase,
        kind: p.kind,
        sourceRef: p.sourceRef,
      })),
      sources: sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        ref: s.ref,
        fetchedAt: s.fetchedAt,
        hasContent: Boolean(s.rawContent),
      })),
    };
  }),
});
