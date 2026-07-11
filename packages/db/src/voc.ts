import { eq } from 'drizzle-orm';
import { newId, normalizePhrase } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { vocPhrases, vocSources } from './schema/index.js';

/** VOC store (WO-014). All access workspace-scoped via the tenancy guard. */

export type VocSourceRow = typeof vocSources.$inferSelect;
export type VocPhraseRow = typeof vocPhrases.$inferSelect;

export async function addVocSource(params: {
  workspaceId: string;
  projectId: string;
  marketId: string;
  kind: 'paste' | 'url';
  ref?: string;
  rawContent?: string;
}): Promise<string> {
  const db = tenantDb(params.workspaceId);
  return db.insert(vocSources, {
    projectId: params.projectId,
    marketId: params.marketId,
    kind: params.kind,
    ref: params.ref ?? null,
    rawContent: params.rawContent ?? null,
    fetchedAt: params.kind === 'paste' ? new Date() : null,
  });
}

export async function getVocSource(
  workspaceId: string,
  sourceId: string,
): Promise<VocSourceRow | null> {
  return tenantDb(workspaceId).findFirst(vocSources, eq(vocSources.id, sourceId));
}

export async function listVocSources(
  workspaceId: string,
  marketId: string,
): Promise<VocSourceRow[]> {
  return tenantDb(workspaceId).findMany(vocSources, eq(vocSources.marketId, marketId));
}

/** Store fetched/readability-extracted content on a URL source. */
export async function setVocSourceContent(
  workspaceId: string,
  sourceId: string,
  rawContent: string,
): Promise<void> {
  await tenantDb(workspaceId).update(
    vocSources,
    { rawContent, fetchedAt: new Date() },
    eq(vocSources.id, sourceId),
  );
}

export async function listMarketPhrases(
  workspaceId: string,
  marketId: string,
): Promise<VocPhraseRow[]> {
  return tenantDb(workspaceId).findMany(vocPhrases, eq(vocPhrases.marketId, marketId));
}

/**
 * Insert phrases for a market, deduping (normalized) against the existing
 * corpus and within the batch. Returns the number inserted.
 */
export async function insertMarketPhrases(params: {
  workspaceId: string;
  marketId: string;
  sourceId: string;
  phrases: { phrase: string; kind: 'pain' | 'desire' | 'objection' | 'identity' }[];
}): Promise<number> {
  const existing = await listMarketPhrases(params.workspaceId, params.marketId);
  const seen = new Set(existing.map((r) => normalizePhrase(r.phrase)));
  const raw = getDb();
  let inserted = 0;
  for (const p of params.phrases) {
    const key = normalizePhrase(p.phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await raw.insert(vocPhrases).values({
      id: newId(),
      workspaceId: params.workspaceId,
      marketId: params.marketId,
      phrase: p.phrase,
      kind: p.kind,
      sourceRef: params.sourceId,
    });
    inserted++;
  }
  return inserted;
}
