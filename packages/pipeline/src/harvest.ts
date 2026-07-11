import { JOB_TYPES } from '@copyforge/core';
import {
  addSwipe,
  enqueueJob,
  getHarvestQuery,
  recordHarvestResult,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Meta Ad Library harvester, manual-trigger v1 (WO-019).
 *
 * The fetcher is an injectable port. The default implementation calls the
 * OFFICIAL Ad Library API (graph.facebook.com/ads_archive) with a token from
 * `META_ADLIB_TOKEN`, rate-limited between pages. When no token is configured
 * or the API refuses, the run DEGRADES CLEANLY: the result records
 * `status: "degraded"` with paste-flow guidance, and nothing breaks — manual
 * paste swipes flow through the exact same decompose path (WO-017).
 */

export const GENOME_HARVEST_JOB = JOB_TYPES.genomeHarvest;

/** Only ads proven to run this long enter the genome (spec WO-019). */
export const MIN_DAYS_RUNNING = 90;

/** ToS-respecting pacing between page fetches (ms). */
export const PAGE_FETCH_INTERVAL_MS = 2_000;
const MAX_PAGES = 3;

export interface HarvestedAd {
  id: string;
  text: string;
  firstSeen: Date;
  lastSeen: Date | null;
}

export class HarvestBlockedError extends Error {
  readonly degraded = true as const;
}

export type AdLibraryFetcher = (query: {
  terms: string;
  country: string;
  page: number;
}) => Promise<HarvestedAd[]>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Official Ad Library API fetcher. Throws HarvestBlockedError when unusable. */
export const defaultAdLibraryFetcher: AdLibraryFetcher = async ({ terms, country, page }) => {
  const token = process.env.META_ADLIB_TOKEN;
  if (!token) {
    throw new HarvestBlockedError(
      'No META_ADLIB_TOKEN configured — the official Ad Library API needs an access token.',
    );
  }
  const url = new URL('https://graph.facebook.com/v19.0/ads_archive');
  url.searchParams.set('search_terms', terms);
  url.searchParams.set('ad_reached_countries', country);
  url.searchParams.set('ad_active_status', 'ACTIVE');
  url.searchParams.set('fields', 'id,ad_creative_bodies,ad_delivery_start_time,ad_delivery_stop_time');
  url.searchParams.set('limit', '25');
  url.searchParams.set('access_token', token);
  if (page > 0) url.searchParams.set('offset', String(page * 25));

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new HarvestBlockedError(`Ad Library API returned HTTP ${res.status}.`);
  }
  const body = (await res.json()) as {
    data?: Array<{
      id: string;
      ad_creative_bodies?: string[];
      ad_delivery_start_time?: string;
      ad_delivery_stop_time?: string;
    }>;
  };
  return (body.data ?? [])
    .filter((ad) => ad.ad_creative_bodies?.length && ad.ad_delivery_start_time)
    .map((ad) => ({
      id: ad.id,
      text: ad.ad_creative_bodies!.join('\n\n'),
      firstSeen: new Date(ad.ad_delivery_start_time!),
      lastSeen: ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : null,
    }));
};

export interface HarvestDeps {
  fetcher?: AdLibraryFetcher;
  now?: () => Date;
  pageIntervalMs?: number;
}

export function createHarvestHandler(deps: HarvestDeps = {}) {
  const fetcher = deps.fetcher ?? defaultAdLibraryFetcher;
  const now = deps.now ?? (() => new Date());
  const interval = deps.pageIntervalMs ?? PAGE_FETCH_INTERVAL_MS;

  return async function handleHarvest(job: ClaimedJob): Promise<void> {
    const queryId = String(job.payload.queryId ?? '');
    if (!queryId) throw new Error('genome.harvest job missing queryId');

    const query = await getHarvestQuery(job.workspaceId, queryId);
    if (!query) throw new Error('Harvest query not found.');
    const spec = query.query as { terms?: string; country?: string };
    const terms = String(spec.terms ?? query.niche);
    const country = String(spec.country ?? 'US');

    try {
      const seen = new Set<string>();
      const kept: HarvestedAd[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        if (page > 0) await sleep(interval); // ToS-respecting pacing
        const ads = await fetcher({ terms, country, page });
        if (ads.length === 0) break;
        for (const ad of ads) {
          if (seen.has(ad.id)) continue;
          seen.add(ad.id);
          const daysRunning = Math.floor(
            ((ad.lastSeen ?? now()).getTime() - ad.firstSeen.getTime()) / 86_400_000,
          );
          if (daysRunning >= MIN_DAYS_RUNNING) kept.push(ad);
        }
      }

      let stored = 0;
      for (const ad of kept) {
        const daysRunning = Math.floor(
          ((ad.lastSeen ?? now()).getTime() - ad.firstSeen.getTime()) / 86_400_000,
        );
        const swipeId = await addSwipe({
          workspaceId: job.workspaceId,
          rawSource: ad.text,
          niche: query.niche,
          channel: 'meta',
          firstSeen: ad.firstSeen,
          lastSeen: ad.lastSeen ?? now(),
          daysRunning,
          tags: ['harvested', `adlib:${ad.id}`],
        });
        await enqueueJob({
          workspaceId: job.workspaceId,
          type: JOB_TYPES.genomeDecompose,
          payload: { swipeId },
        });
        stored++;
      }

      await recordHarvestResult({
        workspaceId: job.workspaceId,
        queryId,
        result: { status: 'ok', stored, filteredOut: seen.size - stored, terms, country },
      });
    } catch (err) {
      if (err instanceof HarvestBlockedError) {
        // Clean degradation: record guidance; the manual paste flow (WO-017
        // genome.addSwipe) is the same downstream path.
        await recordHarvestResult({
          workspaceId: job.workspaceId,
          queryId,
          result: {
            status: 'degraded',
            reason: err.message,
            guidance:
              'Ad Library fetch unavailable. Open facebook.com/ads/library, search your niche, ' +
              'filter to long-running ads, and paste each winner into Genome → Add swipes. ' +
              'Pasted swipes decompose through the identical pipeline.',
          },
        });
        return; // job succeeds — degradation is a valid outcome
      }
      throw err;
    }
  };
}
