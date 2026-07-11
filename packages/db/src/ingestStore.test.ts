import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, parseEmailMetricsCsv } from '@copyforge/core';
import { getDb, closePool } from './client.js';
import { tenantDb } from './guard.js';
import {
  ensureIngestKey,
  ingestEmailMetrics,
  ingestPixelEvent,
  ingestRingbaEvent,
  listTriage,
  resolveIngestKey,
  rotateIngestKey,
  setCampaignMap,
  setTriageStatus,
} from './ingestStore.js';
import { events, markets, projects } from './schema/index.js';

let dbUp = false;
beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('[ingestStore.test] MariaDB unreachable — skipping');
  }
});
afterAll(async () => {
  if (dbUp) await closePool();
});

async function setup(): Promise<{ workspaceId: string; projectId: string; marketId: string }> {
  const workspaceId = newId();
  const projectId = await tenantDb(workspaceId).insert(projects, { name: 'Ingest test' });
  const marketId = await tenantDb(workspaceId).insert(markets, {
    projectId,
    rank: 1,
    label: 'M1',
    schemaVersion: '1',
    profile: { origin: 'engine' },
  });
  return { workspaceId, projectId, marketId };
}

const countEvents = async (workspaceId: string, projectId: string) =>
  (await tenantDb(workspaceId).findMany(events, eq(events.projectId, projectId))).length;

describe('event ingestion (WO-043)', () => {
  it('ingest keys authenticate adapters; rotation invalidates the old key', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const key = await ensureIngestKey(workspaceId, projectId);
    expect(key).toMatch(/^ck_[0-9a-f]{48}$/);
    expect(await ensureIngestKey(workspaceId, projectId)).toBe(key); // stable
    expect(await resolveIngestKey(key)).toEqual({ workspaceId, projectId });

    const rotated = await rotateIngestKey(workspaceId, projectId);
    expect(rotated).not.toBe(key);
    expect(await resolveIngestKey(key)).toBeNull(); // old key dead
    expect(await resolveIngestKey(rotated)).toEqual({ workspaceId, projectId });
    expect(await resolveIngestKey('ck_' + '0'.repeat(48))).toBeNull();
  });

  it('Ringba: unmapped campaigns park in triage (not dropped); mapping routes them; duplicates collapse', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const ctx = { workspaceId, projectId };

    // Unmapped → triage, zero events.
    const first = await ingestRingbaEvent(ctx, { event: 'call_start', campaign: 'meta-m1', callId: 'c-100' });
    expect(first.outcome).toBe('triaged');
    expect(await countEvents(workspaceId, projectId)).toBe(0);
    let triage = await listTriage(workspaceId, projectId);
    expect(triage).toHaveLength(1);
    expect(triage[0]!.reason).toContain('No market mapping for campaign "meta-m1"');

    // Map the campaign → deliveries record with the market attached.
    await setCampaignMap({ workspaceId, projectId, campaign: 'meta-m1', marketId });
    expect((await ingestRingbaEvent(ctx, { event: 'call_start', campaign: 'meta-m1', callId: 'c-100' })).outcome).toBe('recorded');
    // Duplicate delivery collapses (acceptance).
    expect((await ingestRingbaEvent(ctx, { event: 'call_start', campaign: 'meta-m1', callId: 'c-100' })).outcome).toBe('duplicate');
    expect((await ingestRingbaEvent(ctx, { event: 'call_qualified', campaign: 'meta-m1', callId: 'c-100' })).outcome).toBe('recorded');
    expect(await countEvents(workspaceId, projectId)).toBe(2);
    const rows = await tenantDb(workspaceId).findMany(events, eq(events.projectId, projectId));
    expect(rows.every((r) => r.marketId === marketId && r.source === 'ringba')).toBe(true);

    // Malformed → triage.
    expect((await ingestRingbaEvent(ctx, { event: 'call_end', campaign: 'x', callId: 'y' })).outcome).toBe('triaged');
    triage = await listTriage(workspaceId, projectId);
    expect(triage).toHaveLength(2);
    await setTriageStatus({ workspaceId, triageId: triage[0]!.id, status: 'resolved' });
    expect(await listTriage(workspaceId, projectId)).toHaveLength(1);
  });

  it('pixel: quartiles validated, dedupe per session/type/quartile, junk parks in triage', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId, marketId } = await setup();
    const ctx = { workspaceId, projectId };

    expect((await ingestPixelEvent(ctx, { type: 'page_view', sessionRef: 's1', marketId })).outcome).toBe('recorded');
    expect((await ingestPixelEvent(ctx, { type: 'page_view', sessionRef: 's1', marketId })).outcome).toBe('duplicate');
    for (const q of [25, 50, 75, 95]) {
      expect((await ingestPixelEvent(ctx, { type: 'vsl_quartile', sessionRef: 's1', value: { quartile: q } })).outcome).toBe('recorded');
    }
    expect((await ingestPixelEvent(ctx, { type: 'vsl_quartile', sessionRef: 's1', value: { quartile: 50 } })).outcome).toBe('duplicate');
    expect((await ingestPixelEvent(ctx, { type: 'sale', sessionRef: 's1', value: { amount: 1000 } })).outcome).toBe('recorded');

    // Junk → triage, never dropped.
    expect((await ingestPixelEvent(ctx, { type: 'vsl_quartile', sessionRef: 's1', value: { quartile: 60 } })).outcome).toBe('triaged');
    expect((await ingestPixelEvent(ctx, { type: 'checkout_view', sessionRef: 's1' })).outcome).toBe('triaged');
    expect((await ingestPixelEvent(ctx, { type: 'sale' })).outcome).toBe('triaged');
    expect(await listTriage(workspaceId, projectId)).toHaveLength(3);
    expect(await countEvents(workspaceId, projectId)).toBe(6);
  });

  it('email CSV import is replay-safe end to end', async () => {
    if (!dbUp) return;
    const { workspaceId, projectId } = await setup();
    const csv = [
      'email,type,occurred_at',
      'a@example.com,open,2026-07-01T10:00:00Z',
      'a@example.com,click,2026-07-01T10:05:00Z',
    ].join('\n');
    const { rows } = parseEmailMetricsCsv(csv);
    const first = await ingestEmailMetrics({ workspaceId, projectId }, rows);
    expect(first).toEqual({ recorded: 2, duplicates: 0 });
    const replay = await ingestEmailMetrics({ workspaceId, projectId }, rows);
    expect(replay).toEqual({ recorded: 0, duplicates: 2 }); // duplicates collapse
    expect(await countEvents(workspaceId, projectId)).toBe(2);
  });
});
