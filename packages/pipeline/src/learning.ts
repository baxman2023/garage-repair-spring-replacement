import { eq } from 'drizzle-orm';
import {
  extractJsonObject,
  JOB_TYPES,
  parseGenomeDecomposition,
  type AssetBlock,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  addSwipe,
  countComponentsForSwipe,
  findInternalWinnerSwipe,
  findLearningWinners,
  getCurrentAssetVersion,
  getPrompt,
  insertGenomeComponents,
  internalWinnerTag,
  refreshGenomeFeedPacks,
  runCalibration,
  tenantDb,
  assets as assetsTable,
  projects,
  type ClaimedJob,
} from '@copyforge/db';
import { MIN_TYPED_RATIO } from './genomeDecompose.js';

/**
 * Learning loop nightly job (WO-048): the genome eats winners.
 *
 * 1. Promoted challengers + high-Brier-accuracy assets decompose into
 *    genome_components on the WORKSPACE layer, tagged internal-winner —
 *    the shared/own read scope in the genome store keeps them from ever
 *    crossing workspaces.
 * 2. Calibration refreshes (bounded, WO-045).
 * 3. Genome Feed packs refresh for entitled workspaces.
 *
 * Idempotent: each winner's decomposition is ledgered by a tagged swipe with
 * components; re-runs skip finished winners, calibration is deterministic,
 * and pack refresh upserts in place.
 */

export const LEARNING_NIGHTLY_JOB = JOB_TYPES.learningNightly;

export interface LearningDeps {
  clientOptions?: ClientOptions;
}

export interface LearningRunSummary {
  winners: number;
  decomposed: number;
  skipped: number;
  packsRefreshed: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function createLearningNightlyHandler(deps: LearningDeps = {}) {
  const ai = createClient(deps.clientOptions);

  return async function handleLearningNightly(job: ClaimedJob): Promise<void> {
    await runLearningNightly(ai, job.workspaceId, job.id);
  };
}

/** Exposed for tests and the CLI: the handler body with a returned summary. */
export async function runLearningNightly(
  ai: ReturnType<typeof createClient>,
  workspaceId: string,
  jobId?: string,
): Promise<LearningRunSummary> {
  const winners = await findLearningWinners(workspaceId);
  let decomposed = 0;
  let skipped = 0;

  for (const winner of winners) {
    // Idempotency ledger: a tagged swipe WITH components = already eaten.
    const existing = await findInternalWinnerSwipe(workspaceId, winner.assetId);
    if (existing && (await countComponentsForSwipe(existing.id)) > 0) {
      skipped++;
      continue;
    }

    const version = await getCurrentAssetVersion(workspaceId, winner.assetId);
    const text = ((version?.blocks ?? []) as AssetBlock[])
      .map((b) => b.text)
      .filter(Boolean)
      .join('\n\n');
    if (!text.trim()) {
      skipped++;
      continue;
    }

    const db = tenantDb(workspaceId);
    const asset = await db.findFirst(assetsTable, eq(assetsTable.id, winner.assetId));
    const project = asset ? await db.findFirst(projects, eq(projects.id, asset.projectId)) : null;
    const niche = project ? slug(project.name) : 'internal';

    const swipeId =
      existing?.id ??
      (await addSwipe({
        workspaceId,
        rawSource: text,
        niche,
        channel: 'internal',
        tags: ['internal-winner', internalWinnerTag(winner.assetId), winner.reason],
      }));

    const prompt = await getPrompt('genome.decompose');
    if (!prompt) throw new Error('No active prompt "genome.decompose" — run the seed.');
    const result = await ai.generate({
      workspaceId,
      stage: 'genome_decompose',
      jobId,
      system: [{ text: prompt.body, cache: true }],
      messages: [{ role: 'user', content: `SWIPE:\n\n${text.slice(0, 60_000)}` }],
    });
    const decomposition = parseGenomeDecomposition(extractJsonObject(result.text));
    if (decomposition.typedRatio < MIN_TYPED_RATIO) {
      throw new Error(
        `Winner decomposition below quality bar: ${(decomposition.typedRatio * 100).toFixed(0)}% typed.`,
      );
    }

    await insertGenomeComponents({
      workspaceId, // WORKSPACE layer — never the shared corpus.
      swipeId,
      niche,
      channel: 'internal',
      awareness: decomposition.awareness,
      isInternalWinner: true,
      components: decomposition.components,
    });
    decomposed++;
  }

  await runCalibration(workspaceId);
  const packsRefreshed = await refreshGenomeFeedPacks(workspaceId);

  return { winners: winners.length, decomposed, skipped, packsRefreshed };
}
