import {
  extractJsonObject,
  JOB_TYPES,
  parseMarketSelectionResult,
  parseOffer,
  parseProductProfile,
  rankCandidates,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  applyEngineCandidates,
  getApprovedOffer,
  getCurrentProfile,
  getPrompt,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Market Selection Engine (WO-012): fable-5 generates 8–12 candidates, the
 * pure starving-crowd matrix ranks them, and the top 5 land at ranks 1–5 —
 * without touching user-edited market rows (they survive re-runs).
 */

export const MARKET_SELECT_JOB = JOB_TYPES.marketSelect;

export function createMarketSelectHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleMarketSelect(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    if (!projectId) throw new Error('market.select job missing projectId');

    const profileRow = await getCurrentProfile(job.workspaceId, projectId);
    if (!profileRow) throw new Error('Market selection needs a product profile (intake first).');
    const offerRow = await getApprovedOffer(job.workspaceId, projectId);
    if (!offerRow) throw new Error('Market selection needs an approved offer (G0 first).');

    const profile = parseProductProfile(profileRow.profile);
    const offer = parseOffer(offerRow.offer);

    const prompt = await getPrompt('market.select');
    if (!prompt) throw new Error('No active prompt "market.select" — run the seed.');

    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'market_selection',
      projectId,
      jobId: job.id,
      system: [{ text: prompt.body, cache: true }],
      messages: [
        {
          role: 'user',
          content: `PRODUCT PROFILE:\n${JSON.stringify(profile, null, 2)}\n\nAPPROVED OFFER:\n${JSON.stringify(offer, null, 2)}`,
        },
      ],
    });

    const parsed = parseMarketSelectionResult(extractJsonObject(result.text));
    const ranked = rankCandidates(parsed.candidates);

    await applyEngineCandidates({
      workspaceId: job.workspaceId,
      projectId,
      candidates: ranked.map((c) => ({
        label: c.label,
        rationale: c.rationale,
        total: c.total,
        profile: {
          avatar_hint: c.avatar_hint,
          scores: c.scores,
          score_total: c.total,
        },
      })),
    });
  };
}
