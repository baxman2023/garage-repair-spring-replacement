import { z } from 'zod';

/**
 * page_build_package.json contract (spec §4) — the deliverable-of-deliverables.
 * Composed DETERMINISTICALLY (no AI) so the checksum is stable across
 * identical inputs (WO-035 acceptance).
 */

export const PACKAGE_SCHEMA_VERSION = '1';

export const packageBlockSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  text: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const designBriefSchema = z.object({
  /** Ordered: how the page's visual weight follows the persuasion sequence. */
  visual_hierarchy: z.array(
    z.object({
      section: z.string().min(1),
      directive: z.string().min(1),
      weight: z.number().int().min(1).max(5),
    }),
  ),
  cta_choreography: z.object({
    /** When the sticky CTA appears ("t:<seconds>" for video, "block:<id>" for pages). */
    sticky_cta_at: z.string().min(1),
    /** When the buy button reveals (VSL timestamp or letter block). */
    buy_reveal_at: z.string().min(1),
  }),
  tone: z.string().min(1),
  /** Block id → page section name. */
  section_map: z.array(z.object({ block_id: z.string().min(1), section: z.string().min(1) })),
});

export const videoObjectSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.literal('VideoObject'),
  name: z.string().min(1),
  description: z.string().min(1),
  duration: z.string().regex(/^PT(?:\d+M)?\d+S$/),
  uploadDate: z.string().min(1),
});

export const utmVariantSchema = z.object({
  utm_content: z.string().min(1),
  angle: z.string().min(1),
  headline_block: z.string().min(1),
  lead_block: z.string().min(1),
  source: z.string().min(1),
});

export const pageBuildPackageSchema = z.object({
  schema_version: z.string().default(PACKAGE_SCHEMA_VERSION),
  scope: z.object({
    project: z.string().length(26),
    market: z.string().length(26),
    asset: z.string().length(26),
    asset_type: z.string().min(1),
  }),
  copy_blocks: z.array(packageBlockSchema).min(1),
  design_brief: designBriefSchema,
  media: z.object({
    videoobject_schema: videoObjectSchema.nullable(),
    thumbnails_brief: z.string(),
  }),
  quiz_embed: z.object({ snippet_ref: z.string().min(1) }).nullable(),
  message_match: z.object({ utm_variants: z.array(utmVariantSchema) }),
  acceptance_criteria: z.array(z.string().min(1)).min(3),
  self_qa_checklist: z.array(z.string().min(1)).min(3),
  renderings: z.object({
    file_paths: z.array(z.string()),
    macaly_prompt: z.string(),
    universal_llm_prompt: z.string(),
  }),
});

export type PageBuildPackage = z.infer<typeof pageBuildPackageSchema>;
export type PackageDesignBrief = z.infer<typeof designBriefSchema>;
export type PackageUtmVariant = z.infer<typeof utmVariantSchema>;

export function parsePageBuildPackage(data: unknown): PageBuildPackage {
  return pageBuildPackageSchema.parse(data);
}

/** G7 completeness: contract-valid AND all renderings present. */
export function checkG7(pkg: PageBuildPackage): { pass: boolean; missing: string[] } {
  const missing: string[] = [];
  if (pkg.renderings.file_paths.length === 0) missing.push('renderings.file_paths');
  if (!pkg.renderings.macaly_prompt.trim()) missing.push('renderings.macaly_prompt');
  if (!pkg.renderings.universal_llm_prompt.trim()) missing.push('renderings.universal_llm_prompt');
  return { pass: missing.length === 0, missing };
}
