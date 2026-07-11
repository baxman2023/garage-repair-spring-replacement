import { describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import type { ClaimedJob } from '@copyforge/db';
import { WEBHOOK_DELIVER_JOB, createWebhookHandler, type WebhookFetcher } from './webhook.js';

const job = (payload: Record<string, unknown>, attempts = 1): ClaimedJob => ({
  id: newId(),
  workspaceId: newId(),
  type: WEBHOOK_DELIVER_JOB,
  payload,
  attempts,
  jobRunId: newId(),
});

describe('webhook delivery (WO-040)', () => {
  it('POSTs the payload as JSON and succeeds on 2xx', async () => {
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const fetcher: WebhookFetcher = async (url, init) => {
      calls.push({ url, body: init.body, headers: init.headers });
      return { status: 200 };
    };
    await createWebhookHandler({ fetcher })(
      job({ url: 'https://crm.example.com/hooks', body: { kind: 'quiz_lead', band: 'band-2' } }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://crm.example.com/hooks');
    expect(JSON.parse(calls[0]!.body)).toEqual({ kind: 'quiz_lead', band: 'band-2' });
    expect(calls[0]!.headers['content-type']).toBe('application/json');
  });

  it('throws on non-2xx so the queue retries with backoff (acceptance)', async () => {
    const fetcher: WebhookFetcher = async () => ({ status: 502 });
    await expect(
      createWebhookHandler({ fetcher })(job({ url: 'https://crm.example.com/hooks', body: {} }, 3)),
    ).rejects.toThrow(/HTTP 502 \(attempt 3\)/);
  });

  it('rejects jobs without a valid url', async () => {
    const fetcher: WebhookFetcher = async () => ({ status: 200 });
    await expect(createWebhookHandler({ fetcher })(job({ body: {} }))).rejects.toThrow(/no valid url/);
  });
});
