import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@copyforge/core';
import { closePool, getDb, modelRoutes, usageLedger } from '@copyforge/db';
import { createClient } from './client.js';
import { MockTransport } from './mock.js';
import { storeWorkspaceKey } from './vault.js';
import { estimateCostUsd } from './pricing.js';

const STAGE = 'asset_drafting' as const;

async function setupWorkspace(): Promise<string> {
  const ws = newId();
  await storeWorkspaceKey(ws, 'sk-ant-testkey-0000000000');
  await getDb().insert(modelRoutes).values({
    id: newId(),
    workspaceId: ws,
    stage: STAGE,
    primaryModel: 'model-A',
    fallbackChain: ['model-B', 'model-C'],
    maxTokens: 1234,
    active: true,
  });
  return ws;
}

function client(mock: MockTransport) {
  return createClient({ transport: mock, sleep: async () => {}, jitter: () => 0 });
}

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[client.test] MariaDB unreachable — skipping DB-backed client tests');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

describe('ai client (DB-backed, mocked transport)', () => {
  it('routes to the workspace override model and applies its max_tokens', async () => {
    if (!dbUp) return;
    const ws = await setupWorkspace();
    const mock = new MockTransport();
    const res = await client(mock).generate({
      workspaceId: ws,
      stage: STAGE,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.model).toBe('model-A');
    expect(res.attemptsUsed).toBe(1);
    expect(mock.calls[0].req.maxTokens).toBe(1234);
    expect(mock.calls[0].apiKey).toBe('sk-ant-testkey-0000000000');
  });

  it('falls over to the next model on 529 with backoff', async () => {
    if (!dbUp) return;
    const ws = await setupWorkspace();
    const mock = new MockTransport();
    mock.pushOverload(529).pushOverload(529).pushOverload(529).pushText('recovered');
    const res = await client(mock).generate({
      workspaceId: ws,
      stage: STAGE,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.model).toBe('model-B'); // A exhausted 3 attempts, B succeeded
    expect(res.text).toBe('recovered');
    expect(res.attemptsUsed).toBe(4);
  });

  it('records a usage_ledger row with token counts and cost estimate', async () => {
    if (!dbUp) return;
    const ws = await setupWorkspace();
    const mock = new MockTransport();
    mock.pushText('ok', { inputTokens: 100, cacheReadTokens: 20, outputTokens: 50 });
    await client(mock).generate({
      workspaceId: ws,
      stage: STAGE,
      messages: [{ role: 'user', content: 'hi' }],
      projectId: 'proj_1'.padEnd(26, '0'),
    });

    const rows = await getDb()
      .select()
      .from(usageLedger)
      .where(and(eq(usageLedger.workspaceId, ws), eq(usageLedger.model, 'model-A')));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.inputTokens).toBe(100);
    expect(row.cacheReadTokens).toBe(20);
    expect(row.outputTokens).toBe(50);
    expect(row.stage).toBe(STAGE);
    const expectedCost = estimateCostUsd('model-A', {
      inputTokens: 100,
      cacheReadTokens: 20,
      outputTokens: 50,
    });
    expect(Number(row.costEstUsd)).toBeCloseTo(expectedCost, 6);
  });

  it('forwards cache blocks unchanged to the transport', async () => {
    if (!dbUp) return;
    const ws = await setupWorkspace();
    const mock = new MockTransport();
    const system = [
      { text: 'council persona corpus', cache: true },
      { text: 'dynamic user block' },
    ];
    await client(mock).generate({
      workspaceId: ws,
      stage: STAGE,
      system,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(mock.calls[0].req.system).toEqual(system);
  });

  it('throws an actionable error when the workspace has no key', async () => {
    if (!dbUp) return;
    const ws = newId(); // no key stored
    const mock = new MockTransport();
    await expect(
      client(mock).generate({ workspaceId: ws, stage: STAGE, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/API key/i);
    expect(mock.calls.length).toBe(0); // never reached the transport
  });

  it('redacts secrets from a non-retryable error', async () => {
    if (!dbUp) return;
    const ws = await setupWorkspace();
    const mock = new MockTransport();
    mock.pushError('boom sk-ant-leak-1234567890', 400);
    await expect(
      client(mock).generate({ workspaceId: ws, stage: STAGE, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/\[REDACTED\]/);
  });
});
