import { JOB_TYPES, marketProfilePromptBlock, parseMarketProfile } from '@copyforge/core';
import type { ClientOptions } from '@copyforge/ai';
import { enqueueJob, listMarkets, type ClaimedJob } from '@copyforge/db';
import { createCouncilRunner } from './council.js';

/**
 * G3 as a queue job (WO-022): generated assets enter the Council
 * automatically. The market block is built strictly (WO-013 assertion — an
 * undiagnosed market cannot reach G3 prompts). A passing council chains
 * straight into the Synthetic Focus Group (G4, WO-029).
 */

export const ASSET_COUNCIL_JOB = JOB_TYPES.assetCouncil;

export function createCouncilJobHandler(clientOptions: ClientOptions = {}) {
  const runCouncil = createCouncilRunner(clientOptions);

  return async function handleCouncilJob(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const assetId = String(job.payload.assetId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    if (!projectId || !assetId || !marketId) {
      throw new Error('asset.council job missing projectId/assetId/marketId');
    }

    const markets = await listMarkets(job.workspaceId, projectId);
    const market = markets.find((m) => m.id === marketId);
    if (!market) throw new Error('Market not found for council review.');
    const marketBlock = marketProfilePromptBlock(parseMarketProfile(market.profile));

    const outcome = await runCouncil({
      workspaceId: job.workspaceId,
      projectId,
      assetId,
      marketBlock,
      jobId: job.id,
    });

    if (outcome.pass) {
      await enqueueJob({
        workspaceId: job.workspaceId,
        type: JOB_TYPES.assetFocusGroup,
        payload: { projectId, assetId, marketId },
      });
    }
  };
}
