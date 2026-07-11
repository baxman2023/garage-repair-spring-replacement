import {
  emptyProductProfile,
  extractJsonObject,
  extractReadableText,
  JOB_TYPES,
  mergeProductProfiles,
  parseProductProfile,
  type ProductProfile,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import { getCurrentProfile, getPrompt, saveProfileVersion, type ClaimedJob } from '@copyforge/db';

/**
 * Sales Detective dump-mode ingestion (WO-009). One job type handles both
 * paste dumps and URL dumps:
 *
 *   payload: { projectId, text? , url? }
 *
 * URL payloads are fetched (readability-extracted) first; then the dump text
 * runs through the pinned `intake.extract_profile` prompt, is validated
 * against the product_profile contract, merged into the current profile, and
 * saved as a new version.
 */

export const INTAKE_EXTRACT_JOB = JOB_TYPES.intakeExtractProfile;

export type UrlFetcher = (url: string) => Promise<string>;

export const defaultUrlFetcher: UrlFetcher = async (url) => {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'CopyForge-Intake/1.0 (+sales-detective)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Fetch failed with HTTP ${res.status} for ${url}`);
  return res.text();
};

export interface IntakeDeps {
  fetcher?: UrlFetcher;
  clientOptions?: ClientOptions;
}

const MAX_DUMP_CHARS = 60_000;

export function createIntakeHandler(deps: IntakeDeps = {}) {
  const fetcher = deps.fetcher ?? defaultUrlFetcher;
  const ai = createClient(deps.clientOptions);

  return async function handleIntakeExtract(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    if (!projectId) throw new Error('intake job missing projectId');

    let dumpText = typeof job.payload.text === 'string' ? job.payload.text : '';
    const url = typeof job.payload.url === 'string' ? job.payload.url : '';

    if (url) {
      const html = await fetcher(url);
      const { title, text } = extractReadableText(html);
      dumpText = [title, text, dumpText].filter(Boolean).join('\n\n');
    }
    if (!dumpText.trim()) throw new Error('intake job has no dump text after ingestion');
    if (dumpText.length > MAX_DUMP_CHARS) dumpText = dumpText.slice(0, MAX_DUMP_CHARS);

    const prompt = await getPrompt(INTAKE_EXTRACT_JOB);
    if (!prompt) throw new Error(`No active prompt "${INTAKE_EXTRACT_JOB}" — run the seed.`);

    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'classification',
      projectId,
      jobId: job.id,
      system: [{ text: prompt.body, cache: true }],
      messages: [{ role: 'user', content: `RAW DUMP:\n\n${dumpText}` }],
    });

    const extracted = parseProductProfile(extractJsonObject(result.text));
    if (url && !extracted.links.includes(url)) extracted.links.push(url);

    const current = await getCurrentProfile(job.workspaceId, projectId);
    const base: ProductProfile = current
      ? parseProductProfile(current.profile)
      : emptyProductProfile();
    const merged = mergeProductProfiles(base, extracted);

    await saveProfileVersion({
      workspaceId: job.workspaceId,
      projectId,
      profile: merged,
    });
  };
}
