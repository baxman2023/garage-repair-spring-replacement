import {
  extractJsonObject,
  JOB_TYPES,
  parseMarketProfile,
  parseOffer,
  parseProductProfile,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  applyMarketProfile,
  getApprovedOffer,
  getCurrentProfile,
  getPrompt,
  listMarkets,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Schwartz diagnosis (WO-013): one job per market produces the full
 * market_profile.json. The result is contract-parsed (strict — no empty
 * diagnosis fields) before persisting; rank/label/scores are pinned to the
 * stored market row rather than trusting the model's echo.
 */

export const MARKET_PROFILE_JOB = JOB_TYPES.marketProfile;

export function createMarketProfileHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleMarketProfile(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    if (!projectId || !marketId) throw new Error('market.profile job missing projectId/marketId');

    const [profileRow, offerRow, marketRows] = await Promise.all([
      getCurrentProfile(job.workspaceId, projectId),
      getApprovedOffer(job.workspaceId, projectId),
      listMarkets(job.workspaceId, projectId),
    ]);
    if (!profileRow) throw new Error('Market profiling needs a product profile (intake first).');
    if (!offerRow) throw new Error('Market profiling needs an approved offer (G0 first).');
    const market = marketRows.find((m) => m.id === marketId);
    if (!market) throw new Error('Market not found for profiling.');

    const productProfile = parseProductProfile(profileRow.profile);
    const offer = parseOffer(offerRow.offer);
    const seed = market.profile as Record<string, unknown>;

    const prompt = await getPrompt('market.profile');
    if (!prompt) throw new Error('No active prompt "market.profile" — run the seed.');

    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'market_selection',
      projectId,
      jobId: job.id,
      system: [{ text: prompt.body, cache: true }],
      messages: [
        {
          role: 'user',
          content: [
            `PRODUCT PROFILE:\n${JSON.stringify(productProfile, null, 2)}`,
            `APPROVED OFFER:\n${JSON.stringify(offer, null, 2)}`,
            `MARKET TO DIAGNOSE:\n${JSON.stringify(
              {
                rank: market.rank,
                label: market.label,
                rationale: market.rationale,
                avatar_hint: seed.avatar_hint ?? '',
                starving_crowd_scores: seed.scores ?? {},
                score_total: market.scoreTotal ? Number(market.scoreTotal) : 0,
              },
              null,
              2,
            )}`,
          ].join('\n\n'),
        },
      ],
    });

    const raw = extractJsonObject(result.text) as Record<string, unknown>;
    // Pin identity + scores to the stored row; the model's echo is not trusted.
    const scores = (seed.scores ?? {}) as Record<string, number>;
    const pinned = {
      ...raw,
      rank: market.rank,
      label: market.label,
      starving_crowd_scores: {
        pain: scores.pain ?? 0,
        purchasing_power: scores.purchasing_power ?? 0,
        reachability: scores.reachability ?? 0,
        urgency: scores.urgency ?? 0,
        ltv: scores.ltv ?? 0,
        total: market.scoreTotal ? Number(market.scoreTotal) : 0,
      },
    };
    const profile = parseMarketProfile(pinned);

    await applyMarketProfile({
      workspaceId: job.workspaceId,
      projectId,
      marketId,
      profile,
    });
  };
}
