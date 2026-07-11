import { and, eq, isNull } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb, modelRoutes, usageLedger } from '@copyforge/db';
import { requireWorkspaceKey } from './vault.js';
import { redact } from './redact.js';
import { estimateCostUsd } from './pricing.js';
import type { Stage } from './stages.js';
import {
  anthropicTransport,
  isOverloaded,
  type AnthropicResult,
  type ChatMessage,
  type SystemBlock,
  type Transport,
} from './transport.js';

/**
 * The AI client wrapper (WO-006): the single choke point for Anthropic calls.
 * Resolves the workspace key + model route, applies the fallback chain on
 * 429/529 with exponential backoff + jitter, and records a usage-ledger row per
 * call.
 */

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS_PER_MODEL = 3;
const BACKOFF_BASE_MS = 500;

export interface GenerateParams {
  workspaceId: string;
  stage: Stage;
  system?: SystemBlock[];
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Ledger attribution. */
  projectId?: string;
  jobId?: string;
}

export interface GenerateResult {
  model: string;
  text: string;
  stopReason: string | null;
  usage: AnthropicResult['usage'];
  /** How many models in the chain were tried before success. */
  attemptsUsed: number;
}

export interface ClientOptions {
  transport?: Transport;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter in [0,1) for deterministic tests. */
  jitter?: () => number;
}

interface ResolvedRoute {
  primaryModel: string;
  fallbackChain: string[];
  maxTokens: number;
}

async function resolveRoute(workspaceId: string, stage: Stage): Promise<ResolvedRoute> {
  const db = getDb();
  const wsRoute = await db
    .select()
    .from(modelRoutes)
    .where(and(eq(modelRoutes.stage, stage), eq(modelRoutes.workspaceId, workspaceId)))
    .limit(1);
  const route =
    wsRoute[0] ??
    (
      await db
        .select()
        .from(modelRoutes)
        .where(and(eq(modelRoutes.stage, stage), isNull(modelRoutes.workspaceId)))
        .limit(1)
    )[0];

  if (!route || !route.active) {
    throw new Error(`No active model route configured for stage "${stage}".`);
  }
  return {
    primaryModel: route.primaryModel,
    fallbackChain: route.fallbackChain ?? [],
    maxTokens: route.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

function dedupe(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))];
}

export function createClient(options: ClientOptions = {}) {
  const transport = options.transport ?? anthropicTransport;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const jitter = options.jitter ?? Math.random;

  async function recordUsage(
    params: GenerateParams,
    model: string,
    usage: AnthropicResult['usage'],
  ): Promise<void> {
    const cost = estimateCostUsd(model, usage);
    await getDb()
      .insert(usageLedger)
      .values({
        id: newId(),
        workspaceId: params.workspaceId,
        projectId: params.projectId ?? null,
        jobId: params.jobId ?? null,
        stage: params.stage,
        model,
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        outputTokens: usage.outputTokens,
        costEstUsd: cost.toFixed(6),
      });
  }

  async function generate(params: GenerateParams): Promise<GenerateResult> {
    const apiKey = await requireWorkspaceKey(params.workspaceId);
    const route = await resolveRoute(params.workspaceId, params.stage);
    const models = dedupe([route.primaryModel, ...route.fallbackChain]);
    const maxTokens = params.maxTokens ?? route.maxTokens;

    let attemptsUsed = 0;
    let lastError: unknown;

    for (const model of models) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
        attemptsUsed++;
        try {
          const result = await transport.createMessage(
            {
              model,
              maxTokens,
              system: params.system,
              messages: params.messages,
              temperature: params.temperature,
              timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            },
            apiKey,
          );
          await recordUsage(params, result.model || model, result.usage);
          return {
            model: result.model || model,
            text: result.text,
            stopReason: result.stopReason,
            usage: result.usage,
            attemptsUsed,
          };
        } catch (err) {
          lastError = err;
          if (isOverloaded(err)) {
            // Exponential backoff + jitter before retrying / falling over.
            const backoff = BACKOFF_BASE_MS * 2 ** attempt * (1 + jitter());
            await sleep(backoff);
            continue;
          }
          // Non-retryable: redact and surface. The HTTP status survives so
          // the job layer can distinguish permanent failures (401 bad key)
          // from transient ones and skip pointless retries.
          const wrapped = new Error(redact(err)) as Error & { status?: number };
          wrapped.status = (err as { status?: number } | null)?.status;
          throw wrapped;
        }
      }
      // This model stayed overloaded across all attempts → next model in chain.
    }
    throw new Error(`All models exhausted after overload/backoff: ${redact(lastError)}`);
  }

  return { generate };
}

/** Default client using the real Anthropic transport. */
export const aiClient = createClient();

/** Convenience: one-shot generate through the default client. */
export function generate(params: GenerateParams): Promise<GenerateResult> {
  return aiClient.generate(params);
}
