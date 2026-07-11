import {
  dedupePhrases,
  extractJsonObject,
  extractReadableText,
  JOB_TYPES,
  parseVocExtractionResult,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  getPrompt,
  getVocSource,
  insertMarketPhrases,
  listMarketPhrases,
  setVocSourceContent,
  type ClaimedJob,
} from '@copyforge/db';
import { defaultUrlFetcher, type UrlFetcher } from './intake.js';

/**
 * VOC miner (WO-014): fetch (URL sources) → haiku extraction → typed,
 * deduped phrases with source refs. Long sources are chunked so a large
 * corpus still builds in a single job well inside the 2-minute budget.
 */

export const VOC_MINE_JOB = JOB_TYPES.vocMine;

const CHUNK_CHARS = 24_000;

export interface VocMineDeps {
  fetcher?: UrlFetcher;
  clientOptions?: ClientOptions;
}

export function createVocMineHandler(deps: VocMineDeps = {}) {
  const fetcher = deps.fetcher ?? defaultUrlFetcher;
  const ai = createClient(deps.clientOptions);

  return async function handleVocMine(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const sourceId = String(job.payload.sourceId ?? '');
    if (!projectId || !sourceId) throw new Error('voc.mine job missing projectId/sourceId');

    const source = await getVocSource(job.workspaceId, sourceId);
    if (!source) throw new Error('VOC source not found.');
    if (!source.marketId) throw new Error('VOC source has no market.');

    let content = source.rawContent ?? '';
    if (source.kind === 'url') {
      if (!source.ref) throw new Error('URL source missing its URL.');
      const html = await fetcher(source.ref);
      const { title, text } = extractReadableText(html);
      content = [title, text].filter(Boolean).join('\n\n');
      await setVocSourceContent(job.workspaceId, sourceId, content);
    }
    if (!content.trim()) throw new Error('VOC source has no content to mine.');

    const prompt = await getPrompt('voc.extract');
    if (!prompt) throw new Error('No active prompt "voc.extract" — run the seed.');

    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += CHUNK_CHARS) {
      chunks.push(content.slice(i, i + CHUNK_CHARS));
    }

    const collected: { phrase: string; kind: 'pain' | 'desire' | 'objection' | 'identity' }[] = [];
    for (const chunk of chunks) {
      const result = await ai.generate({
        workspaceId: job.workspaceId,
        stage: 'voc_extraction',
        projectId,
        jobId: job.id,
        system: [{ text: prompt.body, cache: true }],
        messages: [{ role: 'user', content: `SOURCE MATERIAL:\n\n${chunk}` }],
      });
      const parsed = parseVocExtractionResult(extractJsonObject(result.text));
      collected.push(
        ...parsed.phrases.filter((p) => p.phrase !== 'NO USABLE VOC IN SOURCE'),
      );
    }

    const existing = await listMarketPhrases(job.workspaceId, source.marketId);
    const fresh = dedupePhrases(collected, existing.map((r) => r.phrase));
    await insertMarketPhrases({
      workspaceId: job.workspaceId,
      marketId: source.marketId,
      sourceId,
      phrases: fresh,
    });
  };
}
