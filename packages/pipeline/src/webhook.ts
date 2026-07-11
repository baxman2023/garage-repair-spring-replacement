import { JOB_TYPES } from '@copyforge/core';
import type { ClaimedJob } from '@copyforge/db';

/**
 * Outbound webhook delivery (WO-040): POST the payload as JSON. A non-2xx or
 * network failure THROWS — the job queue's exponential backoff (WO-007)
 * provides "webhook retries with backoff" up to the job's max attempts.
 */

export const WEBHOOK_DELIVER_JOB = JOB_TYPES.webhookDeliver;

export type WebhookFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

const defaultFetcher: WebhookFetcher = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status };
};

export function createWebhookHandler(deps: { fetcher?: WebhookFetcher } = {}) {
  const fetcher = deps.fetcher ?? defaultFetcher;

  return async function handleWebhook(job: ClaimedJob): Promise<void> {
    const url = String(job.payload.url ?? '');
    const body = job.payload.body;
    if (!/^https?:\/\//.test(url)) throw new Error('webhook.deliver job has no valid url');

    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'CopyForge-Webhook/1.0' },
      body: JSON.stringify(body ?? {}),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Webhook delivery failed with HTTP ${res.status} (attempt ${job.attempts}).`);
    }
  };
}
