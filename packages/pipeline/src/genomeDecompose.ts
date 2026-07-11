import { extractJsonObject, extractReadableText, JOB_TYPES, parseGenomeDecomposition } from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import { getPrompt, getSwipe, insertGenomeComponents, updateSwipeSource, type ClaimedJob } from '@copyforge/db';
import { defaultUrlFetcher, type UrlFetcher } from './intake.js';

/**
 * Genome decomposer (WO-017): one job per swipe. Sonnet breaks the swipe into
 * typed structural components; valid components persist to genome_components
 * on the same layer (shared/workspace) as the swipe. The typed ratio is
 * enforced ≥ MIN_TYPED_RATIO so junky decompositions fail loudly.
 */

export const GENOME_DECOMPOSE_JOB = JOB_TYPES.genomeDecompose;
export const MIN_TYPED_RATIO = 0.9;

/** URL swipes are stored as `URL:<href>` until the worker fetches them. */
export const URL_SWIPE_PREFIX = 'URL:';

export interface GenomeDecomposeDeps {
  clientOptions?: ClientOptions;
  fetcher?: UrlFetcher;
}

export function createGenomeDecomposeHandler(deps: GenomeDecomposeDeps = {}) {
  const ai = createClient(deps.clientOptions);
  const fetcher = deps.fetcher ?? defaultUrlFetcher;

  return async function handleGenomeDecompose(job: ClaimedJob): Promise<void> {
    const swipeId = String(job.payload.swipeId ?? '');
    if (!swipeId) throw new Error('genome.decompose job missing swipeId');

    const swipe = await getSwipe(job.workspaceId, swipeId);
    if (!swipe) throw new Error('Swipe not found (or not visible to this workspace).');

    let source = swipe.rawSource;
    if (source.startsWith(URL_SWIPE_PREFIX)) {
      const url = source.slice(URL_SWIPE_PREFIX.length).trim();
      const html = await fetcher(url);
      const { title, text } = extractReadableText(html);
      source = [title, text].filter(Boolean).join('\n\n');
      if (!source.trim()) throw new Error(`URL swipe fetched empty content: ${url}`);
      await updateSwipeSource(swipe.workspaceId, swipeId, source);
    }

    const prompt = await getPrompt('genome.decompose');
    if (!prompt) throw new Error('No active prompt "genome.decompose" — run the seed.');

    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'genome_decompose',
      jobId: job.id,
      system: [{ text: prompt.body, cache: true }],
      messages: [{ role: 'user', content: `SWIPE:\n\n${source.slice(0, 60_000)}` }],
    });

    const decomposition = parseGenomeDecomposition(extractJsonObject(result.text));
    if (decomposition.typedRatio < MIN_TYPED_RATIO) {
      throw new Error(
        `Decomposition below quality bar: ${(decomposition.typedRatio * 100).toFixed(0)}% typed ` +
          `(${decomposition.dropped} dropped) — needs ≥ ${MIN_TYPED_RATIO * 100}%.`,
      );
    }

    await insertGenomeComponents({
      // Components live on the swipe's layer, not the caller's.
      workspaceId: swipe.workspaceId,
      swipeId,
      niche: swipe.niche ?? decomposition.niche ?? null,
      channel: swipe.channel ?? decomposition.channel ?? null,
      awareness: decomposition.awareness,
      components: decomposition.components,
    });
  };
}
