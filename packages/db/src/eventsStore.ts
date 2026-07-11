import { tenantDb } from './guard.js';
import { events } from './schema/index.js';

/**
 * Ledger event recording (§4). Replay-safe: `dedupe_key` is unique per
 * workspace — duplicate deliveries collapse silently. WO-040 emits native
 * quiz events through this; WO-043 builds the full ingestion surface on it.
 */

export type EventType =
  | 'page_view'
  | 'vsl_quartile'
  | 'quiz_start'
  | 'quiz_complete'
  | 'optin'
  | 'call_start'
  | 'call_qualified'
  | 'sale'
  | 'refund'
  | 'email_open'
  | 'email_click';

export async function recordEvent(params: {
  workspaceId: string;
  projectId?: string | null;
  marketId?: string | null;
  assetId?: string | null;
  type: EventType;
  value?: Record<string, unknown> | null;
  sessionRef?: string | null;
  source: 'ringba' | 'quiz' | 'pixel' | 'email' | 'manual';
  occurredAt?: Date;
  dedupeKey: string;
}): Promise<boolean> {
  try {
    await tenantDb(params.workspaceId).insert(events, {
      projectId: params.projectId ?? null,
      marketId: params.marketId ?? null,
      assetId: params.assetId ?? null,
      type: params.type,
      value: params.value ?? null,
      sessionRef: params.sessionRef ?? null,
      source: params.source,
      occurredAt: params.occurredAt ?? new Date(),
      dedupeKey: params.dedupeKey,
    });
    return true;
  } catch (err) {
    // Unique (workspace_id, dedupe_key): a replayed delivery collapses.
    if (err instanceof Error && /Duplicate entry|ER_DUP_ENTRY/i.test(err.message)) return false;
    throw err;
  }
}
