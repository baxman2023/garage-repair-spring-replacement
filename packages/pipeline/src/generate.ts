import { JOB_TYPES } from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import type { ClaimedJob } from '@copyforge/db';
import { buildGenerationContext } from './generators/context.js';
import { generateSalesLetter, type LetterStructure } from './generators/salesLetter.js';
import { generateVsl } from './generators/vsl.js';
import { generateShortForm } from './generators/shortForm.js';
import { generateWebinar } from './generators/webinar.js';
import { generateEmailSequences } from './generators/emailSequences.js';
import {
  generateAdvertorial,
  generateMetaAds,
  generateNativeAds,
  generateYoutubeAd,
} from './generators/ads.js';
import { generateOrderBump, generateUpsell } from './generators/upsellBump.js';
import type { SequenceKind } from '@copyforge/core';

/**
 * Asset generation dispatcher (WO-022+): one `asset.generate` job type,
 * payload `{ projectId, marketId, assetType, options }`. The same dispatch is
 * shared by the fan-out orchestrator's chained `build.step` jobs (WO-028).
 */

export const ASSET_GENERATE_JOB = JOB_TYPES.assetGenerate;

export interface DispatchArgs {
  workspaceId: string;
  projectId: string;
  marketId: string;
  assetType: string;
  jobId?: string;
  options?: Record<string, unknown>;
}

/** Run one generator by asset type. Throws for unknown types. */
export async function dispatchGeneration(
  ai: ReturnType<typeof createClient>,
  args: DispatchArgs,
): Promise<void> {
  const context = await buildGenerationContext(args.workspaceId, args.projectId, args.marketId);
  const options = args.options ?? {};
  const common = {
    ai,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    jobId: args.jobId,
    context,
  };

  switch (args.assetType) {
    case 'sales_letter':
      await generateSalesLetter({ ...common, structure: options.structure as LetterStructure | undefined });
      return;
    case 'vsl':
      await generateVsl(common);
      return;
    case 'short_form_video':
      await generateShortForm({
        ...common,
        parentVslId: typeof options.parentVslId === 'string' ? options.parentVslId : undefined,
      });
      return;
    case 'webinar':
      await generateWebinar(common);
      return;
    case 'email_sequence':
      await generateEmailSequences({
        ...common,
        sequences: Array.isArray(options.sequences) ? (options.sequences as SequenceKind[]) : undefined,
      });
      return;
    case 'meta_ad':
      await generateMetaAds(common);
      return;
    case 'youtube_ad':
      await generateYoutubeAd(common);
      return;
    case 'native_ad':
      await generateNativeAds(common);
      return;
    case 'advertorial':
      await generateAdvertorial(common);
      return;
    case 'upsell':
      await generateUpsell(common);
      return;
    case 'order_bump':
      await generateOrderBump(common);
      return;
    default:
      throw new Error(`No generator registered for asset type "${args.assetType}" yet.`);
  }
}

export function createGenerateHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleGenerate(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    const assetType = String(job.payload.assetType ?? '');
    if (!projectId || !marketId || !assetType) {
      throw new Error('asset.generate job missing projectId/marketId/assetType');
    }
    await dispatchGeneration(ai, {
      workspaceId: job.workspaceId,
      projectId,
      marketId,
      assetType,
      jobId: job.id,
      options: (job.payload.options ?? {}) as Record<string, unknown>,
    });
  };
}
