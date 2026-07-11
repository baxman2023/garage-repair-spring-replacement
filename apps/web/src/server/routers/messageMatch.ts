import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { env, renderMessageMatchSnippet } from '@copyforge/core';
import { congruenceReport, getAsset, projects, type TenantDb } from '@copyforge/db';
import { router, workspaceProcedure } from '../trpc';

/** Message-match runtime surface (WO-041): snippet + congruence report. */

async function assertProject(db: TenantDb, projectId: string): Promise<void> {
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
}

export const messageMatchRouter = router({
  /** The drop-in snippet for a page asset. */
  snippet: workspaceProcedure
    .input(z.object({ assetId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const asset = await getAsset(ctx.workspaceId, input.assetId);
      if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' });
      const origin = new URL(env.APP_URL).origin;
      return {
        snippet: renderMessageMatchSnippet({ assetId: input.assetId, apiBase: origin }),
        instructions:
          'Paste into the page <head>. Tag the swappable elements with data-mm="headline" and data-mm="lead". Control traffic (no utm_content) pays zero cost.',
      };
    }),

  /** Congruence: tagged ads with no mapped variant are flagged. */
  congruence: workspaceProcedure
    .input(z.object({ projectId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      await assertProject(ctx.db, input.projectId);
      return congruenceReport(ctx.workspaceId, input.projectId);
    }),
});
