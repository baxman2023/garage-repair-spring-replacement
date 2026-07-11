import { z } from 'zod';
import { extractJsonObject, JOB_TYPES, type AssetBlock } from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import { eq } from 'drizzle-orm';
import {
  armMetrics,
  createAsset,
  createChallenger,
  controls as controlsTable,
  enqueueJob,
  getAsset,
  getCurrentAssetVersion,
  getPrompt,
  insertAssetVersion,
  latestFocusGroupRun,
  listCouncilReviewsForAsset,
  tenantDb,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Challenger generation (WO-044): a new asset engineered to beat the control,
 * briefed from the control's OWN weaknesses — Council escalation notes,
 * focus-group annotations, and ledger weak points. The challenger enters the
 * normal gate pipeline (G3 onward) and its lifecycle row starts `queued`.
 */

export const CHALLENGER_GENERATE_JOB = JOB_TYPES.challengerGenerate;

const revisedBlocksSchema = z.object({
  blocks: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.string().min(1),
        text: z.string().min(1),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});

function renderBlocks(blocks: AssetBlock[]): string {
  return blocks.map((b) => `[block ${b.id} · ${b.role}]\n${b.text}`).join('\n\n');
}

/** Assemble the challenger brief from the control's recorded weaknesses. */
export async function buildChallengerBrief(
  workspaceId: string,
  controlAssetId: string,
): Promise<string> {
  const lines: string[] = ['CHALLENGER BRIEF — beat the control by fixing its recorded weaknesses:'];

  const grouped = await listCouncilReviewsForAsset(workspaceId, controlAssetId);
  const latest = grouped[grouped.length - 1];
  if (latest) {
    for (const review of latest.reviews) {
      const notes = (review.notes ?? {}) as { top_fixes?: string[] };
      for (const fix of notes.top_fixes ?? []) {
        lines.push(`- COUNCIL (${review.lens}, ${review.score}): ${fix}`);
      }
    }
  }

  const focusRun = await latestFocusGroupRun(workspaceId, controlAssetId);
  if (focusRun) {
    const annotations = (focusRun.annotations as { annotations?: Array<{ blockId: string; kind: string; note: string }> })
      .annotations ?? [];
    for (const a of annotations.slice(0, 8)) {
      lines.push(`- FOCUS GROUP [block ${a.blockId} · ${a.kind}]: ${a.note}`);
    }
  }

  const metrics = await armMetrics(workspaceId, controlAssetId);
  if (metrics.visitors > 0) {
    const cvr = ((metrics.conversions / metrics.visitors) * 100).toFixed(2);
    lines.push(
      `- LEDGER: ${metrics.visitors} visitors → ${metrics.conversions} sales (${cvr}% CVR). The challenger exists because this number is not good enough.`,
    );
  }

  if (lines.length === 1) lines.push('- No recorded weaknesses — attack the hook and the offer framing with a fundamentally different angle.');
  return lines.join('\n');
}

export function createChallengerGenerateHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleChallengerGenerate(job: ClaimedJob): Promise<void> {
    const controlId = String(job.payload.controlId ?? '');
    if (!controlId) throw new Error('challenger.generate job missing controlId');

    const control = await tenantDb(job.workspaceId).findFirst(controlsTable, eq(controlsTable.id, controlId));
    if (!control) throw new Error('Control not found.');
    const controlAsset = await getAsset(job.workspaceId, control.assetId);
    if (!controlAsset) throw new Error('Control asset not found.');
    const version = await getCurrentAssetVersion(job.workspaceId, control.assetId);
    if (!version) throw new Error('Control asset has no current version.');

    const revisePrompt = await getPrompt('council.revise');
    if (!revisePrompt) throw new Error('No active prompt "council.revise" — run the seed.');

    const brief = await buildChallengerBrief(job.workspaceId, control.assetId);
    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'asset_drafting',
      projectId: control.projectId,
      jobId: job.id,
      system: [{ text: revisePrompt.body, cache: true }],
      messages: [
        {
          role: 'user',
          content: `${brief}\n\nCURRENT CONTROL DRAFT:\n\n${renderBlocks(version.blocks as AssetBlock[])}\n\nReturn the challenger's blocks JSON — a genuinely different attempt, not a light edit.`,
        },
      ],
    });
    const revised = revisedBlocksSchema.parse(extractJsonObject(result.text));

    const challengerAssetId = await createAsset({
      workspaceId: job.workspaceId,
      projectId: control.projectId,
      marketId: control.marketId,
      type: controlAsset.type,
      parentAssetId: control.assetId,
    });
    await insertAssetVersion({
      workspaceId: job.workspaceId,
      assetId: challengerAssetId,
      blocks: revised.blocks as AssetBlock[],
      createdBy: 'challenger',
      meta: { challengerOfControl: controlId, brief },
    });
    await createChallenger({
      workspaceId: job.workspaceId,
      controlId,
      assetId: challengerAssetId,
      sourceNote: brief.split('\n').slice(1, 4).join(' | '),
    });

    // Into the gates: the challenger earns its shot like any other asset.
    await enqueueJob({
      workspaceId: job.workspaceId,
      type: JOB_TYPES.assetCouncil,
      payload: { projectId: control.projectId, assetId: challengerAssetId, marketId: control.marketId },
    });
  };
}
