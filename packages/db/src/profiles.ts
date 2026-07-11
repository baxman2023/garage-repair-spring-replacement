import { desc, eq } from 'drizzle-orm';
import { newId } from '@copyforge/core';
import { getDb } from './client.js';
import { tenantDb } from './guard.js';
import { withTxRetry } from './txRetry.js';
import { productProfiles, projects } from './schema/index.js';

/**
 * Versioned product-profile store (WO-009). All access is workspace-scoped
 * through the tenancy guard; every save creates a new immutable version and
 * flips `is_current` / `projects.current_profile_id`.
 */

export type ProductProfileRow = typeof productProfiles.$inferSelect;

/** The current profile version for a project, or null before first save. */
export async function getCurrentProfile(
  workspaceId: string,
  projectId: string,
): Promise<ProductProfileRow | null> {
  const db = tenantDb(workspaceId);
  const rows = (await db.findMany(productProfiles, eq(productProfiles.projectId, projectId)))
    .filter((r) => r.isCurrent)
    .sort((a, b) => b.version - a.version);
  return rows[0] ?? null;
}

/** All versions for a project, newest first. */
export async function listProfileVersions(
  workspaceId: string,
  projectId: string,
): Promise<ProductProfileRow[]> {
  const db = tenantDb(workspaceId);
  const rows = await db.findMany(productProfiles, eq(productProfiles.projectId, projectId));
  return rows.sort((a, b) => b.version - a.version);
}

/**
 * Save a new profile version (immutable). Returns the new row id. The previous
 * current version is demoted and the project's pointer updated, atomically.
 */
export async function saveProfileVersion(params: {
  workspaceId: string;
  projectId: string;
  profile: Record<string, unknown>;
  createdByUserId?: string | null;
}): Promise<string> {
  const raw = getDb();
  return withTxRetry(() => raw.transaction(async (tx) => {
    // No FOR UPDATE here: locking an empty version range takes gap locks that
    // deadlock concurrent first-inserts. The unique (project_id, version)
    // index turns version races into duplicates, retried by withTxRetry.
    const prev = await tx
      .select({ id: productProfiles.id, version: productProfiles.version })
      .from(productProfiles)
      .where(eq(productProfiles.projectId, params.projectId))
      .orderBy(desc(productProfiles.version))
      .limit(1);

    // Tenancy: confirm the project belongs to this workspace before writing.
    const project = await tx
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);
    if (!project[0] || project[0].workspaceId !== params.workspaceId) {
      throw new Error('Project not found in this workspace.');
    }

    const nextVersion = (prev[0]?.version ?? 0) + 1;
    const id = newId();

    await tx
      .update(productProfiles)
      .set({ isCurrent: false })
      .where(eq(productProfiles.projectId, params.projectId));

    await tx.insert(productProfiles).values({
      id,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      version: nextVersion,
      schemaVersion: '1',
      profile: params.profile,
      isCurrent: true,
      createdByUserId: params.createdByUserId ?? null,
    });

    await tx
      .update(projects)
      .set({ currentProfileId: id, status: 'strategy' })
      .where(eq(projects.id, params.projectId));

    return id;
  }));
}
