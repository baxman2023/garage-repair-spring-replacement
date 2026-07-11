import { and, desc, eq, ne } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { promptVersions } from './schema/index.js';

/**
 * Prompt registry + pinning (WO-008). Prompts are immutable, versioned rows;
 * editing means creating a new version. Assets pin the prompt-version id used
 * at generation, so bumping a prompt never silently changes an existing asset
 * unless the user explicitly upgrades.
 */

export type PromptVersion = typeof promptVersions.$inferSelect;

/** The active version of a named prompt (the loader `getPrompt`). */
export async function getPrompt(name: string): Promise<PromptVersion | null> {
  const rows = await getDb()
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.name, name), eq(promptVersions.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPromptById(id: string): Promise<PromptVersion | null> {
  const rows = await getDb().select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listPromptVersions(name: string): Promise<PromptVersion[]> {
  return getDb()
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.name, name))
    .orderBy(desc(promptVersions.version));
}

export async function listPromptNames(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ name: promptVersions.name })
    .from(promptVersions)
    .orderBy(promptVersions.name);
  return rows.map((r) => r.name);
}

export interface CreatePromptVersionInput {
  name: string;
  body: string;
  description?: string;
  /** Make this the active version (default true). */
  activate?: boolean;
}

/** Create the next version of a prompt (immutable; version auto-increments). */
export async function createPromptVersion(
  input: CreatePromptVersionInput,
): Promise<PromptVersion> {
  const db = getDb();
  const activate = input.activate ?? true;
  return db.transaction(async (tx) => {
    const latest = await tx
      .select({ version: promptVersions.version })
      .from(promptVersions)
      .where(eq(promptVersions.name, input.name))
      .orderBy(desc(promptVersions.version))
      .limit(1);
    const nextVersion = (latest[0]?.version ?? 0) + 1;
    const id = newId();
    await tx.insert(promptVersions).values({
      id,
      name: input.name,
      version: nextVersion,
      body: input.body,
      description: input.description,
      active: activate,
    });
    if (activate) {
      await tx
        .update(promptVersions)
        .set({ active: false })
        .where(and(eq(promptVersions.name, input.name), ne(promptVersions.id, id)));
    }
    const created = await tx.select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
    return created[0]!;
  });
}

/** Make a specific version active (deactivating the others of that name). */
export async function activatePromptVersion(id: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ name: promptVersions.name })
      .from(promptVersions)
      .where(eq(promptVersions.id, id))
      .limit(1);
    const name = rows[0]?.name;
    if (!name) throw new Error(`Prompt version ${id} not found.`);
    await tx.update(promptVersions).set({ active: false }).where(eq(promptVersions.name, name));
    await tx.update(promptVersions).set({ active: true }).where(eq(promptVersions.id, id));
  });
}

export interface ResolvePromptOptions {
  /** The prompt version id pinned to an existing asset, if any. */
  pinnedId?: string | null;
  /** When true, use the current active version instead of the pinned one. */
  upgradeToLatest?: boolean;
}

/**
 * Resolve which prompt version a (re)generation should use. Honors the pinned
 * version unless `upgradeToLatest` is set or no pin exists — then the active
 * version is used.
 */
export async function resolvePromptForGeneration(
  name: string,
  options: ResolvePromptOptions = {},
): Promise<PromptVersion> {
  if (!options.upgradeToLatest && options.pinnedId) {
    const pinned = await getPromptById(options.pinnedId);
    if (pinned) return pinned;
  }
  const active = await getPrompt(name);
  if (!active) throw new Error(`No active prompt version for "${name}".`);
  return active;
}
