import { describe, expect, it } from 'vitest';
import { buildFunnelPlan, FUNNEL_ASSET_SEQUENCE } from './buildPlan.js';

describe('buildFunnelPlan (WO-028, §1.2 ordering)', () => {
  it('orders market-major: every asset for market 1, then market 2', () => {
    const steps = buildFunnelPlan(['m1', 'm2']);
    expect(steps).toHaveLength(FUNNEL_ASSET_SEQUENCE.length * 2);
    const firstHalf = steps.slice(0, FUNNEL_ASSET_SEQUENCE.length);
    const secondHalf = steps.slice(FUNNEL_ASSET_SEQUENCE.length);
    expect(firstHalf.every((s) => s.marketId === 'm1')).toBe(true);
    expect(secondHalf.every((s) => s.marketId === 'm2')).toBe(true);
    expect(firstHalf.map((s) => s.assetType)).toEqual([...FUNNEL_ASSET_SEQUENCE]);
    expect(steps.map((s) => s.seq)).toEqual(steps.map((_s, i) => i)); // dense seq
  });

  it('asset subsets keep canonical dependency order (ads after VSL/letter)', () => {
    const steps = buildFunnelPlan(['m1'], ['meta_ad', 'vsl', 'upsell']);
    expect(steps.map((s) => s.assetType)).toEqual(['vsl', 'meta_ad', 'upsell']);
  });

  it('rejects empty markets and unknown asset types', () => {
    expect(() => buildFunnelPlan([])).toThrow(/at least one market/);
    expect(() => buildFunnelPlan(['m1'], ['banner_ad' as never])).toThrow(/Unknown funnel asset type/);
  });
});
