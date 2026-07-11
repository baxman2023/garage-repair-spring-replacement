import { z } from 'zod';

/**
 * Generated-asset block contract (spec §4): every asset_version stores ordered
 * blocks with these roles. Generators must emit contract-valid blocks.
 */

export const BLOCK_ROLES = [
  'headline',
  'lead',
  'story',
  'mechanism',
  'proof',
  'bullets',
  'offer',
  'close',
  'ps',
  'subject',
  'body',
  'hook',
  'cta',
  'question',
] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

export const generatedBlockSchema = z.object({
  id: z.string().trim().min(1),
  role: z.enum(BLOCK_ROLES),
  text: z.string().trim().min(1),
  meta: z
    .object({
      timestampStart: z.number().nonnegative().optional(),
      timestampEnd: z.number().nonnegative().optional(),
      openLoop: z.boolean().optional(),
      variantOf: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export const generatedBlocksSchema = z.object({
  blocks: z
    .array(generatedBlockSchema)
    .min(3)
    .refine((blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length, {
      message: 'Block ids must be unique',
    }),
});

export type GeneratedBlocks = z.infer<typeof generatedBlocksSchema>;

export function parseGeneratedBlocks(data: unknown): GeneratedBlocks {
  return generatedBlocksSchema.parse(data);
}

/** Claims-extraction result (WO-022/031, haiku stage). */
export const extractedClaimsSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().trim().min(1),
      /** Reference to a proof asset from the product profile, if one carries it. */
      proof_ref: z.string().default(''),
    }),
  ),
});

export function parseExtractedClaims(data: unknown): z.infer<typeof extractedClaimsSchema> {
  return extractedClaimsSchema.parse(data);
}

/** Target lengths per asset type (config, WO-022+). Words unless noted. */
export const TARGET_LENGTHS: Record<string, { min: number; max: number }> = {
  sales_letter: { min: 1200, max: 3000 },
  vsl: { min: 1360, max: 3400 }, // 8–20 min at 170 WPM
  short_form_video: { min: 60, max: 90 },
  webinar: { min: 4000, max: 9000 },
  email: { min: 150, max: 500 },
  advertorial: { min: 800, max: 1800 },
};
