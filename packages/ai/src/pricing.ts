/**
 * Model price table (config) for usage-ledger cost estimates. USD per 1M
 * tokens. These are directional estimates, editable here (or overridable in a
 * future admin surface) — never billed amounts. Unknown models fall back to
 * {@link DEFAULT_PRICE} so cost is always recorded, if approximately.
 */
export interface ModelPrice {
  /** $/1M input tokens. */
  input: number;
  /** $/1M cached-read input tokens. */
  cacheRead: number;
  /** $/1M output tokens. */
  output: number;
}

export const DEFAULT_PRICE: ModelPrice = { input: 3, cacheRead: 0.3, output: 15 };

export const PRICING: Record<string, ModelPrice> = {
  'claude-haiku-4-5-20251001': { input: 1, cacheRead: 0.1, output: 5 },
  'claude-sonnet-4-6': { input: 3, cacheRead: 0.3, output: 15 },
  'claude-fable-5': { input: 5, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 15, cacheRead: 1.5, output: 75 },
};

export interface UsageTokens {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** Estimate the USD cost of a call from its token usage. */
export function estimateCostUsd(model: string, usage: UsageTokens): number {
  const price = PRICING[model] ?? DEFAULT_PRICE;
  return (
    (usage.inputTokens * price.input +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
