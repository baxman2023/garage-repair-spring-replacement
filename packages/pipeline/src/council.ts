import { z } from 'zod';
import {
  aggregateCouncil,
  composeRevisionNotes,
  COUNCIL_LENSES,
  DEFAULT_COUNCIL_CONFIG,
  extractJsonObject,
  parseLensResult,
  type CouncilConfig,
  type CouncilLens,
  type LensResult,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  getCurrentAssetVersion,
  getPrompt,
  insertAssetVersion,
  insertCouncilReviews,
  recordAssetGate,
  setAssetStatus,
  type AssetVersionRow,
} from '@copyforge/db';
import type { AssetBlock } from '@copyforge/db';

/**
 * Council engine (WO-020 / G3): six parallel fable-5 lens calls over the
 * asset's current version, pure aggregation, revision loop (max 3) composed
 * ONLY from failing lenses, then escalation. The persona corpus rides as one
 * shared cached system block (§1.2 block 1); the market profile block is the
 * second cached block; the draft is the dynamic user block.
 */

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

export interface CouncilRunOptions {
  workspaceId: string;
  projectId: string;
  assetId: string;
  /** Market profile cache block text (from marketProfilePromptBlock). */
  marketBlock: string;
  maxLoops?: number;
  config?: CouncilConfig;
  jobId?: string;
}

export interface CouncilLoopRecord {
  versionId: string;
  version: number;
  aggregate: number;
  pass: boolean;
  failingLenses: CouncilLens[];
}

export interface CouncilOutcome {
  pass: boolean;
  escalated: boolean;
  loops: CouncilLoopRecord[];
  finalVersionId: string;
  escalationNotes?: string;
}

function renderBlocks(blocks: AssetBlock[]): string {
  return blocks.map((b) => `[block ${b.id} · ${b.role}]\n${b.text}`).join('\n\n');
}

export function createCouncilRunner(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  async function runLensReviews(
    opts: CouncilRunOptions,
    personaCorpus: string,
    version: AssetVersionRow,
  ): Promise<Record<CouncilLens, LensResult>> {
    const draft = renderBlocks(version.blocks as AssetBlock[]);
    const calls = COUNCIL_LENSES.map(async (lens) => {
      const result = await ai.generate({
        workspaceId: opts.workspaceId,
        stage: 'council',
        projectId: opts.projectId,
        jobId: opts.jobId,
        system: [
          { text: personaCorpus, cache: true },
          { text: opts.marketBlock, cache: true },
        ],
        messages: [
          {
            role: 'user',
            content: `LENS FOR THIS CALL: ${lens}\n\nDRAFT (block-structured):\n\n${draft}\n\nReturn your lens verdict as the JSON contract specifies.`,
          },
        ],
      });
      return [lens, parseLensResult(extractJsonObject(result.text))] as const;
    });
    const entries = await Promise.all(calls);
    return Object.fromEntries(entries) as Record<CouncilLens, LensResult>;
  }

  /**
   * Run the full G3 loop for an asset. Reviews persist per version; on fail
   * the revision pass (failing lenses only) creates the next version, up to
   * `maxLoops` reviews total; then escalate.
   */
  return async function runCouncil(opts: CouncilRunOptions): Promise<CouncilOutcome> {
    const maxLoops = opts.maxLoops ?? 3;
    const config = opts.config ?? DEFAULT_COUNCIL_CONFIG;

    const personas = await getPrompt('council.personas');
    if (!personas) throw new Error('No active prompt "council.personas" — run the seed.');
    const revisePrompt = await getPrompt('council.revise');
    if (!revisePrompt) throw new Error('No active prompt "council.revise" — run the seed.');

    let version = await getCurrentAssetVersion(opts.workspaceId, opts.assetId);
    if (!version) throw new Error('Asset has no current version to review.');

    await setAssetStatus(opts.workspaceId, opts.assetId, 'council');
    const loops: CouncilLoopRecord[] = [];
    let lastResults: Record<CouncilLens, LensResult> | null = null;
    let lastFailing: CouncilLens[] = [];

    for (let loop = 0; loop < maxLoops; loop++) {
      const results = await runLensReviews(opts, personas.body, version);
      await insertCouncilReviews({
        workspaceId: opts.workspaceId,
        assetVersionId: version.id,
        results,
      });
      const verdict = aggregateCouncil(results, config);
      loops.push({
        versionId: version.id,
        version: version.version,
        aggregate: verdict.aggregate,
        pass: verdict.pass,
        failingLenses: verdict.failingLenses,
      });
      lastResults = results;
      lastFailing = verdict.failingLenses;

      if (verdict.pass) {
        await recordAssetGate({
          workspaceId: opts.workspaceId,
          assetId: opts.assetId,
          gate: 'G3',
          pass: true,
          report: { loops, aggregate: verdict.aggregate },
        });
        return { pass: true, escalated: false, loops, finalVersionId: version.id };
      }

      if (loop === maxLoops - 1) break; // out of revision budget

      // Revision pass: brief composed ONLY from failing lenses.
      const brief = composeRevisionNotes(results, verdict.failingLenses);
      await setAssetStatus(opts.workspaceId, opts.assetId, 'revising');
      const revision = await ai.generate({
        workspaceId: opts.workspaceId,
        stage: 'asset_drafting',
        projectId: opts.projectId,
        jobId: opts.jobId,
        system: [
          { text: revisePrompt.body, cache: true },
          { text: opts.marketBlock, cache: true },
        ],
        messages: [
          {
            role: 'user',
            content: `${brief}\n\nCURRENT DRAFT:\n\n${renderBlocks(version.blocks as AssetBlock[])}\n\nReturn the revised blocks JSON.`,
          },
        ],
      });
      const revised = revisedBlocksSchema.parse(extractJsonObject(revision.text));
      const inserted = await insertAssetVersion({
        workspaceId: opts.workspaceId,
        assetId: opts.assetId,
        blocks: revised.blocks as AssetBlock[],
        createdBy: 'system',
        meta: { councilLoop: loop + 1, addressedLenses: verdict.failingLenses },
      });
      version = (await getCurrentAssetVersion(opts.workspaceId, opts.assetId))!;
      if (version.id !== inserted.id) throw new Error('Version pointer drifted during revision.');
      await setAssetStatus(opts.workspaceId, opts.assetId, 'council');
    }

    // Escalate to the user with the failing lenses' notes.
    const escalationNotes = composeRevisionNotes(lastResults!, lastFailing);
    await recordAssetGate({
      workspaceId: opts.workspaceId,
      assetId: opts.assetId,
      gate: 'G3',
      pass: false,
      report: { loops, escalationNotes },
    });
    await setAssetStatus(opts.workspaceId, opts.assetId, 'blocked');
    return { pass: false, escalated: true, loops, finalVersionId: version.id, escalationNotes };
  };
}
