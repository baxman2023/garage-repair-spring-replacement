import { z } from 'zod';
import {
  aggregateFocusGroup,
  composeFocusFixBrief,
  DEFAULT_FOCUS_GROUP_CONFIG,
  extractJsonObject,
  focusBatchSchema,
  JOB_TYPES,
  marketProfilePromptBlock,
  parseMarketProfile,
  samplePersonas,
  type AssetBlock,
  type FocusGroupConfig,
  type FocusGroupReport,
  type PersonaResult,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  enqueueJob,
  getAsset,
  getCurrentAssetVersion,
  getPrompt,
  insertAssetVersion,
  insertFocusGroupRun,
  latestFocusGroupRun,
  listClaims,
  listMarkets,
  recordAssetGate,
  setAssetStatus,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Synthetic Focus Group — gate G4 (WO-029). Twenty personas sampled from the
 * market profile consume the draft in batched fable-5 calls; the aggregate
 * applies §5's config-driven thresholds; annotations (anchored to real block
 * ids) persist in focus_group_runs alongside the gate report. The one-click
 * "fix annotations" pass is its own job: revision brief from the latest run's
 * annotations, one revision version, back to Council.
 */

export const ASSET_FOCUS_GROUP_JOB = JOB_TYPES.assetFocusGroup;
export const ASSET_FOCUS_FIX_JOB = JOB_TYPES.assetFocusFix;

function renderBlocks(blocks: AssetBlock[]): string {
  return blocks.map((b) => `[block ${b.id} · ${b.role}]\n${b.text}`).join('\n\n');
}

async function marketBlockFor(
  workspaceId: string,
  projectId: string,
  marketId: string,
): Promise<string> {
  const markets = await listMarkets(workspaceId, projectId);
  const market = markets.find((m) => m.id === marketId);
  if (!market) throw new Error('Market not found for focus group.');
  return marketProfilePromptBlock(parseMarketProfile(market.profile));
}

export function createFocusGroupHandler(
  clientOptions: ClientOptions = {},
  config: FocusGroupConfig = DEFAULT_FOCUS_GROUP_CONFIG,
) {
  const ai = createClient(clientOptions);

  return async function handleFocusGroup(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const assetId = String(job.payload.assetId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    if (!projectId || !assetId || !marketId) {
      throw new Error('asset.focus_group job missing projectId/assetId/marketId');
    }

    const prompt = await getPrompt('focus_group.simulate');
    if (!prompt) throw new Error('No active prompt "focus_group.simulate" — run the seed.');

    const markets = await listMarkets(job.workspaceId, projectId);
    const market = markets.find((m) => m.id === marketId);
    if (!market) throw new Error('Market not found for focus group.');
    const profile = parseMarketProfile(market.profile);
    const marketBlock = marketProfilePromptBlock(profile);

    const version = await getCurrentAssetVersion(job.workspaceId, assetId);
    if (!version) throw new Error('Asset has no current version for the focus group.');
    const blocks = version.blocks as AssetBlock[];
    const claims = (await listClaims(job.workspaceId, assetId))
      .filter((c) => c.assetVersionId === version.id || !c.assetVersionId)
      .map((c) => c.text);

    const asset = await getAsset(job.workspaceId, assetId);
    if (!asset) throw new Error('Asset not found.');
    if (asset.status !== 'focus_group') {
      await setAssetStatus(job.workspaceId, assetId, 'focus_group');
    }

    // Batched consumption: personaCount personas in batchSize batches.
    const personas = samplePersonas(profile, config.personaCount);
    const results: PersonaResult[] = [];
    for (let i = 0; i < personas.length; i += config.batchSize) {
      const batch = personas.slice(i, i + config.batchSize);
      const result = await ai.generate({
        workspaceId: job.workspaceId,
        stage: 'focus_group',
        projectId,
        jobId: job.id,
        system: [
          { text: prompt.body, cache: true },
          { text: marketBlock, cache: true },
        ],
        messages: [
          {
            role: 'user',
            content: [
              `PERSONAS (simulate EACH, one result per persona):\n${JSON.stringify(batch, null, 2)}`,
              `CLAIMS INVENTORY (for disbelief matching):\n${JSON.stringify(claims)}`,
              `DRAFT (block-structured):\n\n${renderBlocks(blocks)}`,
              'Return {"results":[...]} per the contract.',
            ].join('\n\n'),
          },
        ],
      });
      const parsed = focusBatchSchema.parse(extractJsonObject(result.text));
      if (parsed.results.length !== batch.length) {
        throw new Error(
          `Focus group contract violation: batch returned ${parsed.results.length} results for ${batch.length} personas.`,
        );
      }
      results.push(...parsed.results);
    }

    const report: FocusGroupReport = aggregateFocusGroup({ results, blocks, claims, config });

    await insertFocusGroupRun({
      workspaceId: job.workspaceId,
      assetVersionId: version.id,
      annotations: { annotations: report.annotations },
      pass: report.pass,
      report: report as unknown as Record<string, unknown>,
    });
    await recordAssetGate({
      workspaceId: job.workspaceId,
      assetId,
      gate: 'G4',
      pass: report.pass,
      report: report as unknown as Record<string, unknown>,
    });

    if (report.pass) {
      await setAssetStatus(job.workspaceId, assetId, 'deslop');
    }
    // On fail the asset stays in focus_group with the marked-up report —
    // the user triggers the one-click fix (asset.focus_fix) from there.
  };
}

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

/** One-click "fix annotations": revise per the cohort's notes, back to Council. */
export function createFocusFixHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleFocusFix(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const assetId = String(job.payload.assetId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    if (!projectId || !assetId || !marketId) {
      throw new Error('asset.focus_fix job missing projectId/assetId/marketId');
    }

    const revisePrompt = await getPrompt('council.revise');
    if (!revisePrompt) throw new Error('No active prompt "council.revise" — run the seed.');

    const asset = await getAsset(job.workspaceId, assetId);
    if (!asset) throw new Error('Asset not found.');
    const version = await getCurrentAssetVersion(job.workspaceId, assetId);
    if (!version) throw new Error('Asset has no current version to fix.');
    const blocks = version.blocks as AssetBlock[];

    const run = await latestFocusGroupRun(job.workspaceId, assetId);
    if (!run) throw new Error('No focus-group run to fix — run G4 first.');
    if (run.pass) throw new Error('Latest focus-group run passed — nothing to fix.');

    const brief = composeFocusFixBrief(run.report as unknown as FocusGroupReport, blocks);
    const marketBlock = await marketBlockFor(job.workspaceId, projectId, marketId);

    await setAssetStatus(job.workspaceId, assetId, 'revising');
    const revision = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'asset_drafting',
      projectId,
      jobId: job.id,
      system: [
        { text: revisePrompt.body, cache: true },
        { text: marketBlock, cache: true },
      ],
      messages: [
        {
          role: 'user',
          content: `${brief}\n\nCURRENT DRAFT:\n\n${renderBlocks(blocks)}\n\nReturn the revised blocks JSON.`,
        },
      ],
    });
    const revised = revisedBlocksSchema.parse(extractJsonObject(revision.text));
    await insertAssetVersion({
      workspaceId: job.workspaceId,
      assetId,
      blocks: revised.blocks as AssetBlock[],
      createdBy: 'system',
      meta: { focusFix: true, fixedRunId: run.id },
    });

    // Back through the gates: Council re-reviews, then G4 re-runs on pass.
    await enqueueJob({
      workspaceId: job.workspaceId,
      type: JOB_TYPES.assetCouncil,
      payload: { projectId, assetId, marketId },
    });
  };
}
