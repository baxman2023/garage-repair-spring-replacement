import Anthropic from '@anthropic-ai/sdk';

/**
 * Transport abstraction — the ONLY place a raw Anthropic request is
 * constructed. The client wrapper talks to a {@link Transport}; the default
 * uses the SDK, and tests inject a mock (`mock.ts`) so CI never spends tokens.
 */

export interface SystemBlock {
  text: string;
  /** Mark stable blocks for prompt caching (spec §1.2). */
  cache?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicRequest {
  model: string;
  maxTokens: number;
  system?: SystemBlock[];
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
}

export interface UsageResult {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

export interface AnthropicResult {
  model: string;
  text: string;
  stopReason: string | null;
  usage: UsageResult;
}

export interface Transport {
  createMessage(req: AnthropicRequest, apiKey: string): Promise<AnthropicResult>;
}

/** True for retryable overload/rate-limit responses (spec §1.3: 429/529). */
export function isOverloaded(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 429 || status === 529;
}

export interface SdkTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * Convert ordered cache blocks (spec §1.2) into the SDK `system` param, marking
 * cached blocks with `cache_control: { type: 'ephemeral' }`. Pure/testable.
 */
export function toSystemParam(blocks?: SystemBlock[]): SdkTextBlock[] | undefined {
  if (!blocks?.length) return undefined;
  return blocks.map((b) => ({
    type: 'text',
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
}

/** The default transport: constructs a real Anthropic Messages request. */
export const anthropicTransport: Transport = {
  async createMessage(req, apiKey) {
    const client = new Anthropic({ apiKey, timeout: req.timeoutMs, maxRetries: 0 });
    const system = toSystemParam(req.system);

    const resp = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      model: resp.model,
      text,
      stopReason: resp.stop_reason,
      usage: {
        inputTokens: resp.usage.input_tokens ?? 0,
        outputTokens: resp.usage.output_tokens ?? 0,
        cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: resp.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};
