import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { EmailMetricRow } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { recordEvent } from './eventsStore.js';
import { campaignMarketMaps, eventTriage, projects } from './schema/index.js';

/**
 * Event ingestion (WO-043): per-project ingest keys authenticate the public
 * adapters; anything unmapped or malformed lands in the TRIAGE QUEUE — never
 * dropped. Dedupe keys make every adapter replay-safe.
 */

export type IngestContext = { workspaceId: string; projectId: string };

export async function ensureIngestKey(workspaceId: string, projectId: string): Promise<string> {
  const db = tenantDb(workspaceId);
  const project = await db.findFirst(projects, eq(projects.id, projectId));
  if (!project) throw new Error('Project not found.');
  if (project.ingestKey) return project.ingestKey;
  return rotateIngestKey(workspaceId, projectId);
}

export async function rotateIngestKey(workspaceId: string, projectId: string): Promise<string> {
  const key = `ck_${randomBytes(24).toString('hex')}`;
  await tenantDb(workspaceId).update(projects, { ingestKey: key }, eq(projects.id, projectId));
  return key;
}

/** PUBLIC adapter path: resolve an ingest key to its tenant scope. */
export async function resolveIngestKey(key: string): Promise<IngestContext | null> {
  if (!/^ck_[0-9a-f]{48}$/.test(key)) return null;
  const rows = await getDb().select().from(projects).where(eq(projects.ingestKey, key)).limit(1);
  return rows[0] ? { workspaceId: rows[0].workspaceId, projectId: rows[0].id } : null;
}

// --- Triage queue ---------------------------------------------------------------

export async function triageEvent(params: {
  workspaceId: string;
  projectId: string;
  source: 'ringba' | 'quiz' | 'pixel' | 'email' | 'manual';
  payload: Record<string, unknown>;
  reason: string;
}): Promise<string> {
  return tenantDb(params.workspaceId).insert(eventTriage, {
    projectId: params.projectId,
    source: params.source,
    payload: params.payload,
    reason: params.reason.slice(0, 512),
    status: 'pending',
  });
}

export async function listTriage(
  workspaceId: string,
  projectId: string,
  status: 'pending' | 'resolved' | 'discarded' = 'pending',
) {
  const rows = await tenantDb(workspaceId).findMany(
    eventTriage,
    and(eq(eventTriage.projectId, projectId), eq(eventTriage.status, status)),
  );
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}

export async function setTriageStatus(params: {
  workspaceId: string;
  triageId: string;
  status: 'resolved' | 'discarded';
}): Promise<void> {
  await tenantDb(params.workspaceId).update(
    eventTriage,
    { status: params.status },
    eq(eventTriage.id, params.triageId),
  );
}

// --- Ringba campaign → market map --------------------------------------------------

export async function setCampaignMap(params: {
  workspaceId: string;
  projectId: string;
  campaign: string;
  marketId: string;
}): Promise<void> {
  const db = tenantDb(params.workspaceId);
  const existing = await db.findFirst(
    campaignMarketMaps,
    and(eq(campaignMarketMaps.projectId, params.projectId), eq(campaignMarketMaps.campaign, params.campaign)),
  );
  if (existing) {
    await db.update(campaignMarketMaps, { marketId: params.marketId }, eq(campaignMarketMaps.id, existing.id));
  } else {
    await db.insert(campaignMarketMaps, {
      projectId: params.projectId,
      campaign: params.campaign,
      marketId: params.marketId,
    });
  }
}

export async function listCampaignMaps(workspaceId: string, projectId: string) {
  return tenantDb(workspaceId).findMany(campaignMarketMaps, eq(campaignMarketMaps.projectId, projectId));
}

// --- Adapters -------------------------------------------------------------------------

export type IngestOutcome = { outcome: 'recorded' | 'duplicate' | 'triaged'; reason?: string };

/** Ringba webhook: call_start / call_qualified, campaign-mapped to a market. */
export async function ingestRingbaEvent(
  ctx: IngestContext,
  payload: Record<string, unknown>,
): Promise<IngestOutcome> {
  const event = String(payload.event ?? '');
  const campaign = String(payload.campaign ?? '');
  const callId = String(payload.callId ?? payload.call_id ?? '');
  if (!['call_start', 'call_qualified'].includes(event) || !campaign || !callId) {
    const reason = 'Malformed Ringba payload: need event (call_start|call_qualified), campaign, callId.';
    await triageEvent({ ...ctx, source: 'ringba', payload, reason });
    return { outcome: 'triaged', reason };
  }
  const map = await tenantDb(ctx.workspaceId).findFirst(
    campaignMarketMaps,
    and(eq(campaignMarketMaps.projectId, ctx.projectId), eq(campaignMarketMaps.campaign, campaign)),
  );
  if (!map) {
    const reason = `No market mapping for campaign "${campaign}" — add one in the ingest settings.`;
    await triageEvent({ ...ctx, source: 'ringba', payload, reason });
    return { outcome: 'triaged', reason };
  }
  const occurredAt = payload.occurredAt ? new Date(String(payload.occurredAt)) : undefined;
  const recorded = await recordEvent({
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    marketId: map.marketId,
    type: event as 'call_start' | 'call_qualified',
    value: { campaign, callId },
    sessionRef: callId,
    source: 'ringba',
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
    dedupeKey: `ringba:${callId}:${event}`,
  });
  return { outcome: recorded ? 'recorded' : 'duplicate' };
}

const PIXEL_TYPES = new Set(['page_view', 'vsl_quartile', 'optin', 'sale', 'refund']);
const QUARTILES = new Set([25, 50, 75, 95]);

/** Generic pixel/webhook adapter. */
export async function ingestPixelEvent(
  ctx: IngestContext,
  payload: Record<string, unknown>,
): Promise<IngestOutcome> {
  const type = String(payload.type ?? '');
  const sessionRef = String(payload.sessionRef ?? payload.session_ref ?? '');
  if (!PIXEL_TYPES.has(type) || !sessionRef) {
    const reason = `Malformed pixel payload: need type (${[...PIXEL_TYPES].join('|')}) and sessionRef.`;
    await triageEvent({ ...ctx, source: 'pixel', payload, reason });
    return { outcome: 'triaged', reason };
  }
  let quartile: number | null = null;
  if (type === 'vsl_quartile') {
    quartile = Number((payload.value as { quartile?: unknown } | undefined)?.quartile ?? payload.quartile);
    if (!QUARTILES.has(quartile)) {
      const reason = 'vsl_quartile requires value.quartile in {25,50,75,95}.';
      await triageEvent({ ...ctx, source: 'pixel', payload, reason });
      return { outcome: 'triaged', reason };
    }
  }
  const id26 = (v: unknown): string | null =>
    typeof v === 'string' && /^[0-9A-Za-z]{26}$/.test(v) ? v : null;
  const dedupeKey =
    typeof payload.dedupeKey === 'string' && payload.dedupeKey
      ? `pixel:${payload.dedupeKey.slice(0, 200)}`
      : `pixel:${sessionRef}:${type}${quartile !== null ? `:q${quartile}` : ''}`;
  const recorded = await recordEvent({
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    marketId: id26(payload.marketId),
    assetId: id26(payload.assetId),
    type: type as 'page_view' | 'vsl_quartile' | 'optin' | 'sale' | 'refund',
    value: quartile !== null ? { quartile } : (payload.value as Record<string, unknown> | undefined) ?? null,
    sessionRef,
    source: 'pixel',
    dedupeKey,
  });
  return { outcome: recorded ? 'recorded' : 'duplicate' };
}

/** Email metrics CSV rows (parsed in core) → events; replay-safe per row. */
export async function ingestEmailMetrics(
  ctx: IngestContext,
  rows: EmailMetricRow[],
): Promise<{ recorded: number; duplicates: number }> {
  let recorded = 0;
  let duplicates = 0;
  for (const row of rows) {
    const ok = await recordEvent({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      marketId: row.marketId,
      type: row.type,
      value: { email: row.email },
      source: 'email',
      occurredAt: row.occurredAt,
      dedupeKey: row.dedupeKey,
    });
    if (ok) recorded++;
    else duplicates++;
  }
  return { recorded, duplicates };
}
