import type { AnthropicRequest, AnthropicResult, Transport, UsageResult } from './transport.js';

/**
 * Mocked-AI harness (spec §8, required from WO-006). A {@link Transport} that
 * returns scripted responses / errors and records every call, so tests exercise
 * routing, fallback, and metering without ever spending tokens or hitting the
 * network.
 */

const DEFAULT_USAGE: UsageResult = {
  inputTokens: 10,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 5,
};

type Step = (req: AnthropicRequest) => AnthropicResult;

export interface RecordedCall {
  req: AnthropicRequest;
  apiKey: string;
}

export class MockTransport implements Transport {
  readonly calls: RecordedCall[] = [];
  private readonly queue: Step[] = [];
  private readonly defaultText: string;

  constructor(opts?: { defaultText?: string }) {
    this.defaultText = opts?.defaultText ?? 'mock response';
  }

  /** Enqueue a successful text response with optional usage override. */
  pushText(text: string, usage?: Partial<UsageResult>): this {
    this.queue.push((req) => ({
      model: req.model,
      text,
      stopReason: 'end_turn',
      usage: { ...DEFAULT_USAGE, ...usage },
    }));
    return this;
  }

  /** Enqueue a retryable overload error (429/529) to exercise the fallback chain. */
  pushOverload(status: 429 | 529 = 529): this {
    this.queue.push(() => {
      const err = new Error(`mock overloaded (${status})`) as Error & { status: number };
      err.status = status;
      throw err;
    });
    return this;
  }

  /** Enqueue a non-retryable error. */
  pushError(message: string, status = 400): this {
    this.queue.push(() => {
      const err = new Error(message) as Error & { status: number };
      err.status = status;
      throw err;
    });
    return this;
  }

  async createMessage(req: AnthropicRequest, apiKey: string): Promise<AnthropicResult> {
    this.calls.push({ req, apiKey });
    const step = this.queue.shift();
    if (step) return step(req);
    return {
      model: req.model,
      text: this.defaultText,
      stopReason: 'end_turn',
      usage: { ...DEFAULT_USAGE },
    };
  }
}
