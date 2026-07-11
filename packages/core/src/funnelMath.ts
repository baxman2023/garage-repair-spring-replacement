import { z } from 'zod';

/**
 * Funnel Math (WO-011 / gate G1). Pure, unit-tested economics that kill
 * uneconomic funnels before any generation spend.
 *
 * Definitions:
 * - net revenue per sale  = price × margin × (1 − refund rate)
 * - allowable CPA         = net revenue per sale (breakeven acquisition cost)
 * - breakeven ROAS        = price ÷ allowable CPA = 1 ÷ (margin × (1 − refund))
 * - projected CPA/channel = CPC ÷ CVR(click→sale)
 * - required LTV/channel  = projected CPA ÷ (margin × (1 − refund))
 *   (the customer value needed for that channel to break even)
 */

/**
 * Benchmark click→sale CVRs per channel (config defaults, overridable per run
 * via each channel's `cvr`). Directional industry figures for cold-traffic
 * direct response — not guarantees.
 */
export const BENCHMARK_CVRS: Record<string, number> = {
  meta: 0.01,
  youtube: 0.008,
  search: 0.02,
  native: 0.005,
  tiktok: 0.007,
  email: 0.03,
};
export const DEFAULT_CVR = 0.01;

export const channelInputSchema = z.object({
  name: z.string().min(1),
  /** Cost per click estimate, USD. */
  cpc: z.number().positive(),
  /** Click→sale conversion rate (0–1). Defaults from BENCHMARK_CVRS by name. */
  cvr: z.number().gt(0).lt(1).optional(),
});

export const funnelMathInputsSchema = z.object({
  price: z.number().positive(),
  /** Contribution margin as a fraction (0–1]. */
  margin: z.number().gt(0).max(1),
  /** Expected refund rate as a fraction [0–1). */
  refundRate: z.number().min(0).lt(1).default(0),
  channels: z.array(channelInputSchema).min(1),
});

export type FunnelMathInputs = z.infer<typeof funnelMathInputsSchema>;

export interface ChannelProjection {
  name: string;
  cpc: number;
  cvr: number;
  cvrSource: 'input' | 'benchmark' | 'default';
  projectedCpa: number;
  breaksEven: boolean;
  /** Customer LTV needed for this channel to break even at these economics. */
  requiredLtv: number;
}

export interface FunnelMathFix {
  lever: 'price' | 'margin' | 'cvr' | 'cpc' | 'refunds' | 'aov';
  detail: string;
  /** Multiplier of change required on that lever (smaller = easier). */
  factor: number;
}

export interface FunnelMathReport {
  inputs: FunnelMathInputs;
  netRevenuePerSale: number;
  allowableCpa: number;
  breakevenRoas: number;
  channels: ChannelProjection[];
  bestChannel: string;
  pass: boolean;
  /** Ranked easiest-first. Empty when passing. */
  fixes: FunnelMathFix[];
}

function resolveCvr(channel: z.infer<typeof channelInputSchema>): { cvr: number; source: ChannelProjection['cvrSource'] } {
  if (channel.cvr !== undefined) return { cvr: channel.cvr, source: 'input' };
  const bench = BENCHMARK_CVRS[channel.name.trim().toLowerCase()];
  if (bench !== undefined) return { cvr: bench, source: 'benchmark' };
  return { cvr: DEFAULT_CVR, source: 'default' };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compute the G1 verdict. Throws (zod) on invalid inputs. */
export function computeFunnelMath(rawInputs: unknown): FunnelMathReport {
  const inputs = funnelMathInputsSchema.parse(rawInputs);
  const keepRate = 1 - inputs.refundRate;
  const netRevenuePerSale = inputs.price * inputs.margin * keepRate;
  const allowableCpa = netRevenuePerSale;
  const breakevenRoas = inputs.price / netRevenuePerSale;

  const channels: ChannelProjection[] = inputs.channels.map((ch) => {
    const { cvr, source } = resolveCvr(ch);
    const projectedCpa = ch.cpc / cvr;
    return {
      name: ch.name,
      cpc: ch.cpc,
      cvr,
      cvrSource: source,
      projectedCpa: round2(projectedCpa),
      breaksEven: projectedCpa <= allowableCpa,
      requiredLtv: round2(projectedCpa / (inputs.margin * keepRate)),
    };
  });

  const best = channels.reduce((a, b) => (a.projectedCpa <= b.projectedCpa ? a : b));
  const pass = best.breaksEven;

  const fixes: FunnelMathFix[] = [];
  if (!pass) {
    // How far the best channel is from breakeven; every lever must close this gap.
    const gap = best.projectedCpa / allowableCpa;
    fixes.push(
      {
        lever: 'price',
        factor: gap,
        detail: `Raise price ${round2(gap)}× (to $${round2(inputs.price * gap)}) for ${best.name} to break even at current margin.`,
      },
      {
        lever: 'cvr',
        factor: gap,
        detail: `Lift ${best.name} click→sale CVR ${round2(gap)}× (to ${(best.cvr * gap * 100).toFixed(2)}%) via a stronger offer/funnel.`,
      },
      {
        lever: 'cpc',
        factor: gap,
        detail: `Cut ${best.name} CPC ${round2(gap)}× (to $${round2(best.cpc / gap)}) via better creative/targeting.`,
      },
      {
        lever: 'aov',
        factor: gap,
        detail: `Add bumps/upsells raising net revenue per buyer to $${round2(best.projectedCpa)} (from $${round2(netRevenuePerSale)}).`,
      },
    );
    if (inputs.margin < 0.9) {
      const marginNeeded = Math.min(1, inputs.margin * gap);
      fixes.push({
        lever: 'margin',
        factor: marginNeeded / inputs.margin,
        detail:
          inputs.margin * gap <= 1
            ? `Raise contribution margin to ${(marginNeeded * 100).toFixed(0)}%.`
            : `Margin cannot reach breakeven alone (would need ${(inputs.margin * gap * 100).toFixed(0)}%).`,
      });
    }
    if (inputs.refundRate > 0.05) {
      fixes.push({
        lever: 'refunds',
        factor: 1 / keepRate,
        detail: `Refund rate of ${(inputs.refundRate * 100).toFixed(0)}% is destroying ${(
          inputs.refundRate * 100
        ).toFixed(0)}% of gross — tighten qualification and delivery.`,
      });
    }
    fixes.sort((a, b) => a.factor - b.factor);
  }

  return {
    inputs,
    netRevenuePerSale: round2(netRevenuePerSale),
    allowableCpa: round2(allowableCpa),
    breakevenRoas: round2(breakevenRoas),
    channels,
    bestChannel: best.name,
    pass,
    fixes,
  };
}
