import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { loadRootEnv } from './loadEnv.js';
import { getDb } from './client.js';
import { genomeComponents, swipes } from './schema/index.js';

/**
 * Seed-corpus loader (WO-018): owner-provided genome files in /seed/genome
 * load onto the SHARED layer (workspace_id NULL). Idempotent: swipe ids are
 * derived from each entry's stable key, so re-runs update nothing twice.
 */

const componentFileSchema = z.object({
  type: z.enum(['lead', 'mechanism_name', 'proof_stack', 'price_reveal', 'close', 'bullet_style', 'headline_pattern']),
  content: z.object({
    summary: z.string().min(1),
    evidence: z.string().min(1),
    pattern: z.string().default(''),
  }),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()).default([]),
});

const seedFileSchema = z.object({
  niche: z.string().min(1),
  channel: z.string().default(''),
  swipes: z.array(
    z.object({
      key: z.string().min(1),
      source: z.string().min(1),
      awareness: z.enum(['unaware', 'problem', 'solution', 'product', 'most']).nullable().default(null),
      components: z.array(componentFileSchema).min(1),
    }),
  ),
});

function stableId(namespace: string, key: string): string {
  return createHash('sha256').update(`${namespace}:${key}`).digest('hex').slice(0, 26).toUpperCase();
}

export async function seedGenomeCorpus(seedDir: string): Promise<{ swipes: number; components: number }> {
  const db = getDb();
  let swipeCount = 0;
  let componentCount = 0;

  const files = (await readdir(seedDir)).filter((f) => f.endsWith('.json'));
  for (const file of files.sort()) {
    const parsed = seedFileSchema.parse(JSON.parse(await readFile(join(seedDir, file), 'utf8')));
    for (const entry of parsed.swipes) {
      const swipeId = stableId('seed-swipe', `${parsed.niche}:${entry.key}`);
      const existing = await db.select({ id: swipes.id }).from(swipes).where(eq(swipes.id, swipeId)).limit(1);
      if (existing.length === 0) {
        await db.insert(swipes).values({
          id: swipeId,
          workspaceId: null, // shared seed layer
          rawSource: entry.source,
          niche: parsed.niche,
          channel: parsed.channel || null,
          tags: ['seed'],
        });
        swipeCount++;
      }
      for (let i = 0; i < entry.components.length; i++) {
        const c = entry.components[i]!;
        const componentId = stableId('seed-component', `${parsed.niche}:${entry.key}:${i}`);
        const existingC = await db
          .select({ id: genomeComponents.id })
          .from(genomeComponents)
          .where(eq(genomeComponents.id, componentId))
          .limit(1);
        if (existingC.length > 0) continue;
        await db.insert(genomeComponents).values({
          id: componentId,
          workspaceId: null,
          swipeId,
          type: c.type,
          content: c.content,
          tags: c.tags,
          confidence: c.confidence.toFixed(4),
          niche: parsed.niche,
          channel: parsed.channel || null,
          awareness: entry.awareness,
          isInternalWinner: false,
        });
        componentCount++;
      }
    }
  }
  return { swipes: swipeCount, components: componentCount };
}

// Direct execution: `pnpm db:seed-genome`
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadRootEnv();
  const here = dirname(fileURLToPath(import.meta.url));
  const seedDir = resolve(here, '../../../seed/genome');
  seedGenomeCorpus(seedDir)
    .then(({ swipes: s, components: c }) => {
      console.log(`[db] genome seed complete — swipes:+${s} components:+${c}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[db] genome seed failed', err);
      process.exit(1);
    });
}
