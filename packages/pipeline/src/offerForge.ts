import {
  extractJsonObject,
  JOB_TYPES,
  parseOfferForgeResult,
  parseProductProfile,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import { getCurrentProfile, getPrompt, saveOfferVariants, type ClaimedJob } from '@copyforge/db';

/**
 * Offer Forge (WO-010 / G0): fable-5 pass over the product profile producing a
 * diagnosis + three strengthened variants, persisted as offer versions for the
 * side-by-side picker. Fake scarcity is structurally excluded: the prompt only
 * offers legitimate mechanism types and the offer contract rejects anything
 * else at parse time.
 */

export const OFFER_FORGE_JOB = JOB_TYPES.offerForge;

export function createOfferForgeHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleOfferForge(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    if (!projectId) throw new Error('offer.forge job missing projectId');

    const profileRow = await getCurrentProfile(job.workspaceId, projectId);
    if (!profileRow) {
      throw new Error('Offer Forge needs a product profile — run Sales Detective intake first.');
    }
    const profile = parseProductProfile(profileRow.profile);

    const prompt = await getPrompt('offer.forge');
    if (!prompt) throw new Error('No active prompt "offer.forge" — run the seed.');

    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'offer_forge',
      projectId,
      jobId: job.id,
      system: [{ text: prompt.body, cache: true }],
      messages: [
        { role: 'user', content: `PRODUCT PROFILE JSON:\n\n${JSON.stringify(profile, null, 2)}` },
      ],
    });

    // Contract-parse: rejects wrong variant counts and any illegitimate urgency.
    const forged = parseOfferForgeResult(extractJsonObject(result.text));

    await saveOfferVariants({
      workspaceId: job.workspaceId,
      projectId,
      variants: forged.variants.map((v) => ({ ...v, diagnosis: v.diagnosis || forged.diagnosis })),
    });
  };
}
