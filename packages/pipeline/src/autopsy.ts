import {
  extractJsonObject,
  extractReadableText,
  JOB_TYPES,
  orderAutopsyPages,
  parseAutopsyReport,
  type AutopsyPage,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  getAutopsy,
  getPrompt,
  saveAutopsyPages,
  saveAutopsyReport,
  setAutopsyStatus,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Autopsy teardown job (WO-047). payload: { autopsyId }.
 *
 * Pages given as URLs are auto-fetched and readability-extracted first (and
 * the extracted content is persisted back, so the report and any later
 * rebuild work from the exact text that was analyzed). The Council-scored
 * teardown then runs through the pinned `autopsy.teardown` prompt and must
 * satisfy the autopsy report contract before anything persists.
 */

export const AUTOPSY_RUN_JOB = JOB_TYPES.autopsyRun;

export type UrlFetcher = (url: string) => Promise<string>;

const defaultUrlFetcher: UrlFetcher = async (url) => {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'CopyForge-Autopsy/1.0 (+funnel-teardown)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Fetch failed with HTTP ${res.status} for ${url}`);
  return res.text();
};

export interface AutopsyDeps {
  fetcher?: UrlFetcher;
  clientOptions?: ClientOptions;
}

const PAGE_LABEL: Record<string, string> = {
  ad: 'AD (traffic source creative)',
  landing: 'LANDING PAGE',
  vsl_transcript: 'VSL TRANSCRIPT',
  checkout: 'CHECKOUT / ORDER PAGE',
};

export function createAutopsyRunHandler(deps: AutopsyDeps = {}) {
  const fetcher = deps.fetcher ?? defaultUrlFetcher;
  const ai = createClient(deps.clientOptions);

  return async function handleAutopsyRun(job: ClaimedJob): Promise<void> {
    const autopsyId = String(job.payload.autopsyId ?? '');
    if (!autopsyId) throw new Error('autopsy job missing autopsyId');

    const row = await getAutopsy(job.workspaceId, autopsyId);
    if (!row) throw new Error(`Autopsy ${autopsyId} not found`);

    await setAutopsyStatus(job.workspaceId, autopsyId, 'analyzing');
    try {
      // Auto-fetch URL-sourced pages that have no pasted content yet.
      const pages = row.pages as unknown as AutopsyPage[];
      let fetched = false;
      for (const page of pages) {
        if (page.content?.trim() || !page.sourceUrl) continue;
        const html = await fetcher(page.sourceUrl);
        const { title, text } = extractReadableText(html);
        page.content = [title, text].filter(Boolean).join('\n\n').slice(0, 60_000);
        fetched = true;
      }
      if (fetched) await saveAutopsyPages(job.workspaceId, autopsyId, pages);

      const withContent = orderAutopsyPages(pages.filter((p) => p.content?.trim()));
      if (withContent.length === 0) throw new Error('Autopsy has no page content after ingestion');

      const prompt = await getPrompt(AUTOPSY_RUN_JOB);
      if (!prompt) throw new Error(`No active prompt "${AUTOPSY_RUN_JOB}" — run the seed.`);

      const funnelDump = withContent
        .map((p) => `## ${PAGE_LABEL[p.kind] ?? p.kind}\n${p.content!.trim()}`)
        .join('\n\n');
      const result = await ai.generate({
        workspaceId: job.workspaceId,
        stage: 'autopsy',
        jobId: job.id,
        system: [{ text: prompt.body, cache: true }],
        messages: [{ role: 'user', content: `FUNNEL TO AUTOPSY: ${row.title}\n\n${funnelDump}` }],
      });

      const report = parseAutopsyReport(extractJsonObject(result.text));
      await saveAutopsyReport(job.workspaceId, autopsyId, report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setAutopsyStatus(job.workspaceId, autopsyId, 'failed', message.slice(0, 512));
      throw err;
    }
  };
}
