import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { env, parseEmailMetricsCsv } from '@copyforge/core';
import {
  ensureIngestKey,
  ingestEmailMetrics,
  listCampaignMaps,
  listMarkets,
  listTriage,
  projects,
  rotateIngestKey,
  setCampaignMap,
  setTriageStatus,
  triageEvent,
  type TenantDb,
} from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/**
 * Event ingestion surface (WO-043): ingest key management, the Ringba
 * campaign→market map UI, email-CSV import, and the triage queue.
 */

const projectScoped = z.object({ projectId: z.string().length(26) });

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const ingestRouter = router({
  /** Ingest key + adapter endpoints + current maps + pending triage. */
  settings: workspaceProcedure.input(projectScoped).query(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    const [key, maps, triage, markets] = await Promise.all([
      ensureIngestKey(ctx.workspaceId, input.projectId),
      listCampaignMaps(ctx.workspaceId, input.projectId),
      listTriage(ctx.workspaceId, input.projectId, 'pending'),
      listMarkets(ctx.workspaceId, input.projectId),
    ]);
    const origin = new URL(env.APP_URL).origin;
    return {
      ingestKey: key,
      endpoints: {
        ringba: `${origin}/api/ingest/${key}/ringba`,
        pixel: `${origin}/api/ingest/${key}/pixel`,
      },
      campaignMaps: maps.map((m) => ({ id: m.id, campaign: m.campaign, marketId: m.marketId })),
      markets: markets.map((m) => ({ id: m.id, rank: m.rank, label: m.label })),
      triage: triage.map((t) => ({
        id: t.id,
        source: t.source,
        reason: t.reason,
        payload: t.payload,
        at: t.createdAt,
      })),
    };
  }),

  rotateKey: workspaceProcedure.input(projectScoped).mutation(async ({ ctx, input }) => {
    await assertProject(ctx.db, input.projectId);
    return { ingestKey: await rotateIngestKey(ctx.workspaceId, input.projectId) };
  }),

  setCampaignMap: workspaceProcedure
    .input(projectScoped.extend({ campaign: z.string().trim().min(1), marketId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      await setCampaignMap({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        campaign: input.campaign,
        marketId: input.marketId,
      });
      return { ok: true as const };
    }),

  resolveTriage: workspaceProcedure
    .input(z.object({ triageId: z.string().length(26), status: z.enum(['resolved', 'discarded']) }))
    .mutation(async ({ ctx, input }) => {
      await setTriageStatus({ workspaceId: ctx.workspaceId, triageId: input.triageId, status: input.status });
      return { ok: true as const };
    }),

  /** Email metrics CSV import: good rows → events; bad rows → triage. */
  importEmailCsv: workspaceProcedure
    .input(projectScoped.extend({ csv: z.string().min(1).max(2_000_000) }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      const parsed = parseEmailMetricsCsv(input.csv);
      const result = await ingestEmailMetrics(
        { workspaceId: ctx.workspaceId, projectId: input.projectId },
        parsed.rows,
      );
      for (const bad of parsed.bad) {
        await triageEvent({
          workspaceId: ctx.workspaceId,
          projectId: input.projectId,
          source: 'email',
          payload: { line: bad.line, raw: bad.raw },
          reason: bad.reason,
        });
      }
      return { ...result, triaged: parsed.bad.length };
    }),
});
