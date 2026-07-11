import { z } from 'zod';

/**
 * Offer contract (WO-010 / gate G0). Urgency is structurally constrained to
 * legitimate mechanism types, each requiring a stated legitimacy basis —
 * fake scarcity cannot be expressed in a contract-valid offer.
 */

export const OFFER_SCHEMA_VERSION = '1';

/** The only urgency mechanisms the system accepts (spec §5 G0 / §6 Kennedy). */
export const URGENCY_TYPES = [
  'deadline',
  'cohort_close',
  'bonus_expiry',
  'price_increase',
  'capacity_limit',
  'seasonal',
] as const;
export type UrgencyType = (typeof URGENCY_TYPES)[number];

/** Phrases that mark fabricated scarcity; contract-invalid wherever they appear. */
const FAKE_SCARCITY_MARKERS =
  /\b(fake|false|artificial|fabricat\w*|pretend|simulated?|reset(ting)?\s+countdown|evergreen\s+(timer|countdown)|fear\s*of\s*missing\s*out\s*hack)\b/i;

const honestText = (label: string) =>
  z
    .string()
    .min(1)
    .refine((s) => !FAKE_SCARCITY_MARKERS.test(s), {
      message: `${label} must not describe fabricated scarcity`,
    });

export const urgencyMechanismSchema = z.object({
  type: z.enum(URGENCY_TYPES),
  description: honestText('urgency description'),
  legitimacy_basis: honestText('legitimacy basis'),
});

export const valueStackItemSchema = z.object({
  item: z.string().min(1),
  value_usd: z.number().positive(),
  justification: z.string().default(''),
});

export const offerSchema = z.object({
  schema_version: z.string().default(OFFER_SCHEMA_VERSION),
  name: z.string().default(''),
  diagnosis: z.string().default(''),
  value_stack: z.array(valueStackItemSchema).default([]),
  risk_reversal: z.string().default(''),
  urgency_mechanisms: z.array(urgencyMechanismSchema).default([]),
  price_framing: z.string().default(''),
  price: z
    .object({
      amount: z.number().nonnegative().default(0),
      model: z.string().default(''),
    })
    .default({ amount: 0, model: '' }),
  offer_name_candidates: z.array(z.string()).default([]),
});

export type Offer = z.infer<typeof offerSchema>;

export function parseOffer(data: unknown): Offer {
  return offerSchema.parse(data);
}

/** The Offer Forge model output: diagnosis + exactly three variants. */
export const offerForgeResultSchema = z.object({
  diagnosis: z.string().min(1),
  variants: z.array(offerSchema).length(3),
});
export type OfferForgeResult = z.infer<typeof offerForgeResultSchema>;

export function parseOfferForgeResult(data: unknown): OfferForgeResult {
  return offerForgeResultSchema.parse(data);
}

// --- G0 checklist (spec §5) --------------------------------------------------

export interface G0Report {
  pass: boolean;
  failures: string[];
  checklist: {
    quantified_value_stack: boolean;
    risk_reversal: boolean;
    legitimate_urgency: boolean;
    price_framing: boolean;
    named: boolean;
  };
}

/** Pure G0 gate check: the offer must satisfy every checklist item. */
export function checkG0(offer: Offer): G0Report {
  const checklist = {
    quantified_value_stack:
      offer.value_stack.length > 0 && offer.value_stack.every((i) => i.value_usd > 0),
    risk_reversal: offer.risk_reversal.trim().length > 0,
    legitimate_urgency: offer.urgency_mechanisms.length >= 1,
    price_framing: offer.price_framing.trim().length > 0,
    named: offer.name.trim().length > 0,
  };
  const failures: string[] = [];
  if (!checklist.quantified_value_stack)
    failures.push('Value stack must exist and every item must carry a positive dollar value.');
  if (!checklist.risk_reversal) failures.push('A risk reversal is required.');
  if (!checklist.legitimate_urgency)
    failures.push('At least one legitimate urgency mechanism is required.');
  if (!checklist.price_framing) failures.push('Price framing is required.');
  if (!checklist.named) failures.push('The offer needs a name.');
  return { pass: failures.length === 0, failures, checklist };
}
