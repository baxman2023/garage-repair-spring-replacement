/**
 * Fan-out build plan (WO-028, pure). Steps are ordered to maximize §1.2 cache
 * hits: ALL assets for market 1, then market 2, … — the market-profile cache
 * block stays warm across every asset of a market before moving on. Within a
 * market, core assets (VSL, letter) come first because ads message-match them.
 */

/** Default per-market generation chain, in cache- and dependency-order. */
export const FUNNEL_ASSET_SEQUENCE = [
  'sales_letter',
  'vsl',
  'short_form_video',
  'webinar',
  'email_sequence',
  'meta_ad',
  'youtube_ad',
  'native_ad',
  'advertorial',
  'upsell',
  'order_bump',
] as const;
export type FunnelAssetType = (typeof FUNNEL_ASSET_SEQUENCE)[number];

export interface BuildPlanStep {
  seq: number;
  marketId: string;
  assetType: FunnelAssetType;
}

/**
 * Expand ranked market ids × asset types into the ordered step list
 * (market-major). `assetTypes` defaults to the full funnel; a subset keeps the
 * canonical sequence order regardless of how the caller listed it.
 */
export function buildFunnelPlan(
  marketIds: string[],
  assetTypes?: FunnelAssetType[],
): BuildPlanStep[] {
  if (marketIds.length === 0) throw new Error('A build plan needs at least one market.');
  const requested = assetTypes && assetTypes.length > 0 ? new Set(assetTypes) : null;
  if (requested) {
    for (const t of requested) {
      if (!(FUNNEL_ASSET_SEQUENCE as readonly string[]).includes(t)) {
        throw new Error(`Unknown funnel asset type "${t}".`);
      }
    }
  }
  const chain = FUNNEL_ASSET_SEQUENCE.filter((t) => !requested || requested.has(t));
  const steps: BuildPlanStep[] = [];
  for (const marketId of marketIds) {
    for (const assetType of chain) {
      steps.push({ seq: steps.length, marketId, assetType });
    }
  }
  return steps;
}
