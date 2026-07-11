import { JOB_TYPES } from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import type { ClaimedJob } from '@copyforge/db';
import { buildGenerationContext } from './generators/context.js';
import { generateSalesLetter, type LetterStructure } from './generators/salesLetter.js';
import { generateVsl } from './generators/vsl.js';
import { generateShortForm } from './generators/shortForm.js';
import { generateWebinar } from './generators/webinar.js';
import { generateEmailSequences } from './generators/emailSequences.js';
import type { SequenceKind } from '@copyforge/core';

/**
 * Asset generation dispatcher (WO-022+): one `asset.generate` job type,
 * payload `{ projectId, marketId, assetType, options }`. Generators for the
 * remaining asset types register here as their work orders land.
 */

export const ASSET_GENERATE_JOB = JOB_TYPES.assetGenerate;

export function createGenerateHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleGenerate(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    const assetType = String(job.payload.assetType ?? '');
    if (!projectId || !marketId || !assetType) {
      throw new Error('asset.generate job missing projectId/marketId/assetType');
    }

    const context = await buildGenerationContext(job.workspaceId, projectId, marketId);
    const options = (job.payload.options ?? {}) as Record<string, unknown>;

    switch (assetType) {
      case 'sales_letter':
        await generateSalesLetter({
          ai,
          workspaceId: job.workspaceId,
          projectId,
          jobId: job.id,
          context,
          structure: options.structure as LetterStructure | undefined,
        });
        return;
      case 'vsl':
        await generateVsl({ ai, workspaceId: job.workspaceId, projectId, jobId: job.id, context });
        return;
      case 'short_form_video':
        await generateShortForm({
          ai,
          workspaceId: job.workspaceId,
          projectId,
          jobId: job.id,
          context,
          parentVslId: typeof options.parentVslId === 'string' ? options.parentVslId : undefined,
        });
        return;
      case 'webinar':
        await generateWebinar({ ai, workspaceId: job.workspaceId, projectId, jobId: job.id, context });
        return;
      case 'email_sequence':
        await generateEmailSequences({
          ai,
          workspaceId: job.workspaceId,
          projectId,
          jobId: job.id,
          context,
          sequences: Array.isArray(options.sequences) ? (options.sequences as SequenceKind[]) : undefined,
        });
        return;
      default:
        throw new Error(`No generator registered for asset type "${assetType}" yet.`);
    }
  };
}
