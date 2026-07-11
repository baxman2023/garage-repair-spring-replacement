import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { genomeComponents, swipes } from './schema/index.js';

/**
 * Genome store (WO-017/018). Two layers share these tables:
 * - workspace_id NULL      → shared seed corpus (visible to everyone)
 * - workspace_id non-NULL  → workspace-private swipes / internal winners
 *
 * Reads always scope to (shared OR own-workspace); private rows NEVER cross
 * workspaces (WO-048 leak rule).
 */

export type SwipeRow = typeof swipes.$inferSelect;
export type GenomeComponentRow = typeof genomeComponents.$inferSelect;

export async function addSwipe(params: {
  workspaceId: string | null;
  rawSource: string;
  niche?: string;
  channel?: string;
  firstSeen?: Date;
  lastSeen?: Date;
  daysRunning?: number;
  tags?: string[];
}): Promise<string> {
  const id = newId();
  await getDb().insert(swipes).values({
    id,
    workspaceId: params.workspaceId,
    rawSource: params.rawSource,
    niche: params.niche ?? null,
    channel: params.channel ?? null,
    firstSeen: params.firstSeen ?? null,
    lastSeen: params.lastSeen ?? null,
    daysRunning: params.daysRunning ?? null,
    tags: params.tags ?? [],
  });
  return id;
}

export async function getSwipe(
  workspaceId: string | null,
  swipeId: string,
): Promise<SwipeRow | null> {
  const rows = await getDb().select().from(swipes).where(eq(swipes.id, swipeId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  // Visible when shared, or owned by this workspace.
  if (row.workspaceId !== null && row.workspaceId !== workspaceId) return null;
  return row;
}

/** Replace a swipe's raw source (URL fetch landing). Layer-checked. */
export async function updateSwipeSource(
  workspaceId: string | null,
  swipeId: string,
  rawSource: string,
): Promise<void> {
  const rows = await getDb().select().from(swipes).where(eq(swipes.id, swipeId)).limit(1);
  const row = rows[0];
  if (!row || (row.workspaceId !== null && row.workspaceId !== workspaceId)) {
    throw new Error('Swipe not found (or not visible to this workspace).');
  }
  await getDb().update(swipes).set({ rawSource }).where(eq(swipes.id, swipeId));
}

export async function listSwipes(workspaceId: string, niche?: string): Promise<SwipeRow[]> {
  const scope = or(isNull(swipes.workspaceId), eq(swipes.workspaceId, workspaceId)) as SQL;
  const where = niche ? (and(scope, eq(swipes.niche, niche)) as SQL) : scope;
  const rows = await getDb().select().from(swipes).where(where);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function insertGenomeComponents(params: {
  workspaceId: string | null;
  swipeId: string;
  niche: string | null;
  channel: string | null;
  awareness: 'unaware' | 'problem' | 'solution' | 'product' | 'most' | null;
  isInternalWinner?: boolean;
  components: Array<{
    type: 'lead' | 'mechanism_name' | 'proof_stack' | 'price_reveal' | 'close' | 'bullet_style' | 'headline_pattern';
    content: Record<string, unknown>;
    confidence: number;
    tags: string[];
  }>;
}): Promise<number> {
  const db = getDb();
  for (const c of params.components) {
    await db.insert(genomeComponents).values({
      id: newId(),
      workspaceId: params.workspaceId,
      swipeId: params.swipeId,
      type: c.type,
      content: c.content,
      tags: c.tags,
      confidence: c.confidence.toFixed(4),
      niche: params.niche,
      channel: params.channel,
      awareness: params.awareness,
      isInternalWinner: params.isInternalWinner ?? false,
    });
  }
  return params.components.length;
}

export interface ComponentQuery {
  workspaceId: string;
  type?: GenomeComponentRow['type'];
  niche?: string;
  channel?: string;
  awareness?: GenomeComponentRow['awareness'];
  limit?: number;
}

/** Query components by type/niche/channel/awareness (shared + own layer). */
export async function queryGenomeComponents(q: ComponentQuery): Promise<GenomeComponentRow[]> {
  const conds: SQL[] = [
    or(isNull(genomeComponents.workspaceId), eq(genomeComponents.workspaceId, q.workspaceId)) as SQL,
  ];
  if (q.type) conds.push(eq(genomeComponents.type, q.type));
  if (q.niche) conds.push(eq(genomeComponents.niche, q.niche));
  if (q.channel) conds.push(eq(genomeComponents.channel, q.channel));
  if (q.awareness) conds.push(eq(genomeComponents.awareness, q.awareness));
  const rows = await getDb()
    .select()
    .from(genomeComponents)
    .where(and(...conds) as SQL);
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, q.limit ?? 100);
}
