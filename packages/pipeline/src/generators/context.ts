import {
  genomePromptBlock,
  marketProfilePromptBlock,
  parseMarketProfile,
  parseOffer,
  parseProductProfile,
  vocCorpusPromptBlock,
  type MarketProfile,
  type Offer,
  type ProductProfile,
} from '@copyforge/core';
import {
  getApprovedOffer,
  getCurrentProfile,
  listMarketPhrases,
  listMarkets,
  retrieveGenome,
} from '@copyforge/db';

/**
 * Shared generation context (WO-022+). Builds the §1.2 cache-block stack every
 * generator consumes:
 *   1. genome block   (largest / most stable)
 *   2. market block   (stable across all assets in a market's fan-out)
 *   3. VOC block      (stable per market)
 *   4. dynamic user block (never cached — supplied by each generator)
 *
 * Building this THROWS on an undiagnosed market (marketProfilePromptBlock is
 * strict) — the WO-013 assertion that generators cannot run on markets
 * without a full Schwartz diagnosis.
 */

export interface GenerationContext {
  profile: ProductProfile;
  offer: Offer;
  market: MarketProfile;
  marketId: string;
  niche: string;
  genomeBlock: string;
  marketBlock: string;
  vocBlock: string;
}

export async function buildGenerationContext(
  workspaceId: string,
  projectId: string,
  marketId: string,
): Promise<GenerationContext> {
  const [profileRow, offerRow, markets] = await Promise.all([
    getCurrentProfile(workspaceId, projectId),
    getApprovedOffer(workspaceId, projectId),
    listMarkets(workspaceId, projectId),
  ]);
  if (!profileRow) throw new Error('Generation needs a product profile (intake first).');
  if (!offerRow) throw new Error('Generation needs an approved offer (G0 first).');
  const marketRow = markets.find((m) => m.id === marketId);
  if (!marketRow) throw new Error('Market not found for generation.');

  const profile = parseProductProfile(profileRow.profile);
  const offer = parseOffer(offerRow.offer);
  const market = parseMarketProfile(marketRow.profile); // throws when undiagnosed
  const niche = profile.category || market.label;

  const [components, phrases] = await Promise.all([
    retrieveGenome({ workspaceId, niche, limit: 40 }),
    listMarketPhrases(workspaceId, marketId),
  ]);

  const genomeBlock = genomePromptBlock(
    components.map((c) => ({
      id: c.id,
      type: c.type,
      niche: c.niche,
      content: (c.content ?? {}) as { summary?: string; evidence?: string; pattern?: string },
      confidence: c.confidence ? Number(c.confidence) : 0.5,
      seenAt: c.createdAt,
    })),
    new Date(),
  ).text;

  const marketBlock = marketProfilePromptBlock(market);
  const vocBlock =
    phrases.length > 0
      ? vocCorpusPromptBlock(phrases.map((p) => ({ phrase: p.phrase, kind: p.kind })))
      : 'VOICE OF CUSTOMER CORPUS: (none mined yet — write in the avatar\'s plain language)';

  return { profile, offer, market, marketId, niche, genomeBlock, marketBlock, vocBlock };
}
