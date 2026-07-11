import { describe, expect, it } from 'vitest';
import { BENCHMARK_CVRS, computeFunnelMath } from './funnelMath.js';

describe('funnel math (G1)', () => {
  it('computes allowable CPA, breakeven ROAS, projected CPA, required LTV', () => {
    const r = computeFunnelMath({
      price: 1000,
      margin: 0.8,
      refundRate: 0.1,
      channels: [{ name: 'meta', cpc: 2, cvr: 0.01 }],
    });
    // net = 1000 * 0.8 * 0.9 = 720
    expect(r.netRevenuePerSale).toBe(720);
    expect(r.allowableCpa).toBe(720);
    expect(r.breakevenRoas).toBeCloseTo(1000 / 720, 2);
    // projected CPA = 2 / 0.01 = 200 → passes
    expect(r.channels[0]!.projectedCpa).toBe(200);
    expect(r.channels[0]!.requiredLtv).toBeCloseTo(200 / 0.72, 1);
    expect(r.pass).toBe(true);
    expect(r.fixes).toEqual([]);
  });

  it('hard-stops an uneconomic funnel with a ranked fix list', () => {
    const r = computeFunnelMath({
      price: 100,
      margin: 0.5,
      refundRate: 0.2,
      channels: [
        { name: 'meta', cpc: 4, cvr: 0.01 }, // CPA 400 vs allowable 40
        { name: 'search', cpc: 6, cvr: 0.02 }, // CPA 300 ← best
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.bestChannel).toBe('search');
    expect(r.channels.every((c) => !c.breaksEven)).toBe(true);
    expect(r.fixes.length).toBeGreaterThanOrEqual(4);
    // Ranked easiest-first (ascending factor).
    const factors = r.fixes.map((f) => f.factor);
    expect([...factors].sort((a, b) => a - b)).toEqual(factors);
    // Gap = 300/40 = 7.5×: price fix quantified against the BEST channel.
    const price = r.fixes.find((f) => f.lever === 'price')!;
    expect(price.detail).toContain('7.5×');
    expect(price.detail).toContain('$750');
    // Margin can't reach breakeven alone at a 7.5× gap.
    const margin = r.fixes.find((f) => f.lever === 'margin')!;
    expect(margin.detail).toMatch(/cannot reach breakeven/);
    // High refund rate called out.
    expect(r.fixes.some((f) => f.lever === 'refunds')).toBe(true);
  });

  it('uses benchmark CVRs by channel name and a default otherwise', () => {
    const r = computeFunnelMath({
      price: 2000,
      margin: 0.9,
      refundRate: 0,
      channels: [
        { name: 'Meta', cpc: 1.5 },
        { name: 'carrier-pigeon', cpc: 1 },
      ],
    });
    expect(r.channels[0]!.cvr).toBe(BENCHMARK_CVRS.meta);
    expect(r.channels[0]!.cvrSource).toBe('benchmark');
    expect(r.channels[1]!.cvrSource).toBe('default');
  });

  it('edge: 100% margin, zero refunds — breakeven ROAS is exactly 1', () => {
    const r = computeFunnelMath({
      price: 500,
      margin: 1,
      refundRate: 0,
      channels: [{ name: 'email', cpc: 0.1, cvr: 0.03 }],
    });
    expect(r.breakevenRoas).toBe(1);
    expect(r.allowableCpa).toBe(500);
  });

  it('edge: boundary economics — projected CPA exactly equals allowable CPA', () => {
    const r = computeFunnelMath({
      price: 100,
      margin: 1,
      refundRate: 0,
      channels: [{ name: 'x', cpc: 1, cvr: 0.01 }], // CPA 100 == allowable 100
    });
    expect(r.pass).toBe(true); // breakeven counts as pass (≤)
  });

  it('rejects invalid inputs', () => {
    const base = { price: 100, margin: 0.5, refundRate: 0, channels: [{ name: 'meta', cpc: 1 }] };
    expect(() => computeFunnelMath({ ...base, price: 0 })).toThrow();
    expect(() => computeFunnelMath({ ...base, price: -5 })).toThrow();
    expect(() => computeFunnelMath({ ...base, margin: 0 })).toThrow();
    expect(() => computeFunnelMath({ ...base, margin: 1.2 })).toThrow();
    expect(() => computeFunnelMath({ ...base, refundRate: 1 })).toThrow();
    expect(() => computeFunnelMath({ ...base, channels: [] })).toThrow();
    expect(() => computeFunnelMath({ ...base, channels: [{ name: 'meta', cpc: 0 }] })).toThrow();
    expect(() =>
      computeFunnelMath({ ...base, channels: [{ name: 'meta', cpc: 1, cvr: 1.5 }] }),
    ).toThrow();
  });
});
