import { z } from 'zod';
import { JOB_TYPES } from '@copyforge/core';
import {
  addSwipe,
  enqueueJob,
  listHarvestQueries,
  listSwipes,
  queryGenomeComponents,
  saveHarvestQuery,
  triggerHarvest,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/**
 * Persuasion Genome (WO-017): swipe intake (paste/URL) + component queries.
 * Swipes added here land on the workspace-private layer. Decomposition is
 * pre-G1 knowledge-base work, so it uses the plain queue.
 */
export const genomeRouter = router({
  addSwipe: workspaceProcedure
    .input(
      z.object({
        kind: z.enum(['paste', 'url']),
        content: z.string().max(200_000).optional(),
        url: z.string().url().max(2048).optional(),
        niche: z.string().max(128).optional(),
        channel: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rawSource =
        input.kind === 'paste' ? (input.content ?? '').trim() : `URL:${input.url ?? ''}`;
      if (input.kind === 'paste' && !rawSource) {
        throw new Error('Paste swipes need content.');
      }
      if (input.kind === 'url' && !input.url) {
        throw new Error('URL swipes need a URL.');
      }
      const swipeId = await addSwipe({
        workspaceId: ctx.workspaceId,
        rawSource,
        niche: input.niche,
        channel: input.channel,
      });
      const jobId = await enqueueJob({
        workspaceId: ctx.workspaceId,
        type: JOB_TYPES.genomeDecompose,
        payload: { swipeId },
      });
      return { swipeId, jobId };
    }),

  swipes: workspaceProcedure
    .input(z.object({ niche: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await listSwipes(ctx.workspaceId, input.niche);
      return rows.map((s) => ({
        id: s.id,
        niche: s.niche,
        channel: s.channel,
        shared: s.workspaceId === null,
        daysRunning: s.daysRunning,
        preview: s.rawSource.slice(0, 140),
        createdAt: s.createdAt,
      }));
    }),

  components: workspaceProcedure
    .input(
      z.object({
        type: z
          .enum(['lead', 'mechanism_name', 'proof_stack', 'price_reveal', 'close', 'bullet_style', 'headline_pattern'])
          .optional(),
        niche: z.string().optional(),
        channel: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await queryGenomeComponents({ workspaceId: ctx.workspaceId, ...input });
      return rows.map((c) => ({
        id: c.id,
        type: c.type,
        niche: c.niche,
        channel: c.channel,
        awareness: c.awareness,
        confidence: c.confidence ? Number(c.confidence) : null,
        content: c.content,
        tags: c.tags,
        shared: c.workspaceId === null,
      }));
    }),

  /** Saved Ad Library queries per niche (WO-019). */
  harvestQueries: workspaceProcedure.query(async ({ ctx }) => {
    const rows = await listHarvestQueries(ctx.workspaceId);
    return rows.map((q) => ({
      id: q.id,
      niche: q.niche,
      query: q.query,
      lastRunAt: q.lastRunAt,
      lastResult: q.lastResult,
    }));
  }),

  saveHarvestQuery: workspaceProcedure
    .input(
      z.object({
        niche: z.string().min(1).max(128),
        terms: z.string().min(1).max(255),
        country: z.string().length(2).default('US'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await saveHarvestQuery({
        workspaceId: ctx.workspaceId,
        niche: input.niche,
        query: { terms: input.terms, country: input.country },
      });
      return { id };
    }),

  /** Manual harvest trigger — always allowed (scheduling is entitlement-gated). */
  runHarvest: workspaceProcedure
    .input(z.object({ queryId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const jobId = await triggerHarvest(ctx.workspaceId, input.queryId);
      return { jobId };
    }),
});
