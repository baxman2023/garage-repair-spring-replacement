import { createHash } from 'node:crypto';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, isNull } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { loadRootEnv } from './loadEnv.js';
import * as schema from './schema/index.js';
import { featureFlags, modelRoutes, promptVersions } from './schema/index.js';

loadRootEnv();

type Db = MySql2Database<typeof schema>;

/** Deterministic 26-char id for a seed row so re-seeding never duplicates. */
function stableId(namespace: string, key: string): string {
  return createHash('sha256')
    .update(`${namespace}:${key}`)
    .digest('hex')
    .slice(0, 26)
    .toUpperCase();
}

// --- Model routes (spec §1.1). NULL workspace_id = platform defaults. ---
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const FABLE = 'claude-fable-5';
// Fallback chain (spec §1.3): fable-5 → opus-4-8 → sonnet-4-6.
const FALLBACK_CHAIN = ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6'];

const MODEL_ROUTE_SEEDS: { stage: string; primaryModel: string; maxTokens: number }[] = [
  { stage: 'classification', primaryModel: HAIKU, maxTokens: 1024 },
  { stage: 'voc_extraction', primaryModel: HAIKU, maxTokens: 4096 },
  { stage: 'claims_extraction', primaryModel: HAIKU, maxTokens: 4096 },
  { stage: 'scrub', primaryModel: HAIKU, maxTokens: 4096 },
  { stage: 'asset_drafting', primaryModel: SONNET, maxTokens: 8192 },
  { stage: 'council', primaryModel: FABLE, maxTokens: 4096 },
  { stage: 'focus_group', primaryModel: FABLE, maxTokens: 8192 },
  { stage: 'autopsy', primaryModel: FABLE, maxTokens: 8192 },
  { stage: 'offer_forge', primaryModel: FABLE, maxTokens: 8192 },
  { stage: 'market_selection', primaryModel: FABLE, maxTokens: 8192 },
];

// --- Feature flags. Platform-level toggles / kill switches (WO-052). ---
const FEATURE_FLAG_SEEDS: { key: string; enabled: boolean; description: string }[] = [
  { key: 'signups_enabled', enabled: true, description: 'Allow new user signups.' },
  { key: 'harvester_enabled', enabled: true, description: 'Meta Ad Library harvester (WO-019).' },
  {
    key: 'genome_feed_scheduling',
    enabled: false,
    description: 'Scheduled Genome Feed harvest runs (entitlement-gated, WO-051).',
  },
  {
    key: 'worker_generation_enabled',
    enabled: true,
    description: 'Master switch for generation worker job types.',
  },
];

/**
 * Prompt registry seeds. Generation prompts are authored by their owning work
 * orders (Council WO-020, generators WO-022+, etc.) and appended here as they
 * land.
 */
const PROMPT_SEEDS: { name: string; version: number; body: string; description: string; active: boolean }[] = [
  {
    name: 'intake.extract_profile',
    version: 1,
    description:
      'Sales Detective dump-mode extraction: raw dump text → product_profile.json fields (WO-009).',
    active: true,
    body: `You are the Sales Detective for a direct-response funnel system. You are given a raw dump of material about a product or offer: sales pages, notes, transcripts, emails, or web copy.

Extract everything you can into the product profile JSON below. Rules:
- Output ONLY a single JSON object, no prose, no code fences.
- Use empty strings / empty arrays for anything the dump does not contain. NEVER invent facts, numbers, testimonials, or guarantees that are not in the dump.
- "promise" is the single biggest outcome promised to the buyer, in one sentence.
- "mechanism.problem_mechanism" is WHY the problem persists; "mechanism.solution_mechanism" is WHY this solution works where others fail; "mechanism.name" is the branded name of the mechanism if one exists.
- "proof_assets" entries: {"type": one of "testimonial"|"study"|"demo"|"statistic"|"credential"|"other", "ref": the concrete proof text, "strength": "strong"|"medium"|"weak"}.
- "enemy" is the villain the buyer blames (a person, industry, habit, or belief).
- "price": {"amount": number (0 if unknown), "model": e.g. "one-time"|"subscription"|"tiers"}.
- "constraints.compliance_mode": "health" if the offer makes health/body claims, "finance" if it makes money/earnings claims, else "none".
- "founder_voice_samples": verbatim passages (1-3) that best capture the founder's natural voice, if any.
- "prior_attempts": past marketing attempts and their outcomes mentioned in the dump.
- "links": URLs mentioned in the dump.

JSON shape:
{"schema_version":"1","name":"","category":"","promise":"","mechanism":{"problem_mechanism":"","solution_mechanism":"","name":""},"origin_story":"","founder_voice_samples":[],"proof_assets":[],"enemy":"","price":{"amount":0,"model":""},"guarantees":[],"constraints":{"compliance_mode":"none","banned_claims":[]},"prior_attempts":[],"links":[]}`,
  },
];

async function seedModelRoutes(db: Db): Promise<number> {
  let inserted = 0;
  for (const row of MODEL_ROUTE_SEEDS) {
    const existing = await db
      .select({ id: modelRoutes.id })
      .from(modelRoutes)
      .where(and(isNull(modelRoutes.workspaceId), eq(modelRoutes.stage, row.stage)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(modelRoutes).values({
      id: stableId('model_route', row.stage),
      workspaceId: null,
      stage: row.stage,
      primaryModel: row.primaryModel,
      fallbackChain: FALLBACK_CHAIN,
      maxTokens: row.maxTokens,
      active: true,
    });
    inserted++;
  }
  return inserted;
}

async function seedFeatureFlags(db: Db): Promise<number> {
  let inserted = 0;
  for (const row of FEATURE_FLAG_SEEDS) {
    const existing = await db
      .select({ id: featureFlags.id })
      .from(featureFlags)
      .where(eq(featureFlags.key, row.key))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(featureFlags).values({
      id: stableId('feature_flag', row.key),
      key: row.key,
      enabled: row.enabled,
      description: row.description,
    });
    inserted++;
  }
  return inserted;
}

async function seedPromptVersions(db: Db): Promise<number> {
  let inserted = 0;
  for (const row of PROMPT_SEEDS) {
    const existing = await db
      .select({ id: promptVersions.id })
      .from(promptVersions)
      .where(and(eq(promptVersions.name, row.name), eq(promptVersions.version, row.version)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(promptVersions).values({
      id: stableId('prompt', `${row.name}@${row.version}`),
      name: row.name,
      version: row.version,
      body: row.body,
      description: row.description,
      active: row.active,
    });
    inserted++;
  }
  return inserted;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to seed.');

  const connection = await mysql.createConnection(url);
  const db = drizzle(connection, { schema, mode: 'default' });

  const routes = await seedModelRoutes(db);
  const flags = await seedFeatureFlags(db);
  const prompts = await seedPromptVersions(db);

  console.log(
    `[db] seed complete — model_routes:+${routes} feature_flags:+${flags} prompt_versions:+${prompts}`,
  );

  await connection.end();
}

main().catch((err) => {
  console.error('[db] seed failed', err);
  process.exit(1);
});
