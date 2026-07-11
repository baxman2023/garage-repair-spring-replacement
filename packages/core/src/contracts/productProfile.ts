import { z } from 'zod';

/**
 * product_profile.json contract (spec §4), zod-validated and versioned with
 * `schema_version`. Draft profiles are valid documents with empty fields;
 * {@link unansweredProfileFields} drives the adaptive interrogation flow.
 */

export const PROFILE_SCHEMA_VERSION = '1';

export const proofAssetSchema = z.object({
  type: z.string().default(''),
  ref: z.string().default(''),
  strength: z.string().default(''),
});

export const productProfileSchema = z.object({
  schema_version: z.string().default(PROFILE_SCHEMA_VERSION),
  name: z.string().default(''),
  category: z.string().default(''),
  promise: z.string().default(''),
  mechanism: z
    .object({
      problem_mechanism: z.string().default(''),
      solution_mechanism: z.string().default(''),
      name: z.string().default(''),
    })
    .default({ problem_mechanism: '', solution_mechanism: '', name: '' }),
  origin_story: z.string().default(''),
  founder_voice_samples: z.array(z.string()).default([]),
  proof_assets: z.array(proofAssetSchema).default([]),
  enemy: z.string().default(''),
  price: z
    .object({
      amount: z.number().nonnegative().default(0),
      model: z.string().default(''),
    })
    .default({ amount: 0, model: '' }),
  guarantees: z.array(z.string()).default([]),
  constraints: z
    .object({
      compliance_mode: z.enum(['none', 'health', 'finance']).default('none'),
      banned_claims: z.array(z.string()).default([]),
    })
    .default({ compliance_mode: 'none', banned_claims: [] }),
  prior_attempts: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
});

export type ProductProfile = z.infer<typeof productProfileSchema>;

/** A fresh, empty (but contract-valid) draft profile. */
export function emptyProductProfile(): ProductProfile {
  return productProfileSchema.parse({});
}

/**
 * Validate arbitrary data as a product profile. Throws (zod) on structural
 * violations; fills defaults for absent fields.
 */
export function parseProductProfile(data: unknown): ProductProfile {
  return productProfileSchema.parse(data);
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return v === 0;
  return false;
}

/**
 * Merge an incoming (e.g. AI-extracted) profile into a base profile.
 * Non-empty incoming values win; empty incoming values never clobber existing
 * data. Arrays are unioned (dedup by JSON identity), preserving base order.
 */
export function mergeProductProfiles(
  base: ProductProfile,
  incoming: Partial<ProductProfile>,
): ProductProfile {
  const inc = productProfileSchema.parse({ ...base, ...stripEmpty(incoming) });

  const unionArr = <T>(a: T[], b: T[]): T[] => {
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    const out = [...a];
    for (const item of b) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  };

  return {
    ...inc,
    mechanism: {
      problem_mechanism: pick(base.mechanism.problem_mechanism, incoming.mechanism?.problem_mechanism),
      solution_mechanism: pick(base.mechanism.solution_mechanism, incoming.mechanism?.solution_mechanism),
      name: pick(base.mechanism.name, incoming.mechanism?.name),
    },
    price: {
      amount: incoming.price && !isEmptyValue(incoming.price.amount) ? incoming.price.amount : base.price.amount,
      model: pick(base.price.model, incoming.price?.model),
    },
    constraints: {
      compliance_mode:
        incoming.constraints && incoming.constraints.compliance_mode !== 'none'
          ? incoming.constraints.compliance_mode
          : base.constraints.compliance_mode,
      banned_claims: unionArr(base.constraints.banned_claims, incoming.constraints?.banned_claims ?? []),
    },
    founder_voice_samples: unionArr(base.founder_voice_samples, incoming.founder_voice_samples ?? []),
    proof_assets: unionArr(base.proof_assets, (incoming.proof_assets ?? []).map((p) => proofAssetSchema.parse(p))),
    guarantees: unionArr(base.guarantees, incoming.guarantees ?? []),
    prior_attempts: unionArr(base.prior_attempts, incoming.prior_attempts ?? []),
    links: unionArr(base.links, incoming.links ?? []),
  };
}

function pick(baseVal: string, incVal: string | undefined): string {
  return incVal && incVal.trim() !== '' ? incVal : baseVal;
}

function stripEmpty(obj: Partial<ProductProfile>): Partial<ProductProfile> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!isEmptyValue(v)) out[k] = v;
  }
  return out as Partial<ProductProfile>;
}

// --- Interrogation (adaptive question flow) ---------------------------------

/** A field the Sales Detective can ask about. */
export interface IntakeQuestion {
  /** Dot-path into the profile the answer fills. */
  field: string;
  question: string;
  /** How a free-text answer maps into the profile. */
  kind: 'text' | 'number' | 'list' | 'choice';
  choices?: readonly string[];
}

/** Interrogation catalog (spec WO-009 field list). Order = interview order. */
export const INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  { field: 'name', question: 'What is the product or offer called?', kind: 'text' },
  { field: 'category', question: 'What category or niche is it in?', kind: 'text' },
  { field: 'promise', question: 'What is the single biggest promise it makes to the buyer?', kind: 'text' },
  { field: 'origin_story', question: 'What is the origin story — how and why was this created?', kind: 'text' },
  {
    field: 'mechanism.problem_mechanism',
    question: 'What is the real underlying mechanism of the problem — why does the problem persist?',
    kind: 'text',
  },
  {
    field: 'mechanism.solution_mechanism',
    question: 'What is the unique mechanism of the solution — why does it work when others fail?',
    kind: 'text',
  },
  { field: 'mechanism.name', question: 'Does the mechanism have a name? If not, describe it in a phrase.', kind: 'text' },
  {
    field: 'proof_assets',
    question: 'List your proof assets (testimonials, studies, demos, numbers) — one per line.',
    kind: 'list',
  },
  { field: 'enemy', question: 'Who or what is the enemy — the villain your buyer blames?', kind: 'text' },
  { field: 'price.amount', question: 'What is the price (number)?', kind: 'number' },
  { field: 'price.model', question: 'What is the pricing model (one-time, subscription, tiers…)?', kind: 'text' },
  { field: 'guarantees', question: 'What guarantees do you offer — one per line.', kind: 'list' },
  {
    field: 'constraints.compliance_mode',
    question: 'Which compliance mode applies: none, health, or finance?',
    kind: 'choice',
    choices: ['none', 'health', 'finance'] as const,
  },
  {
    field: 'prior_attempts',
    question: 'What marketing or funnels have you tried before, and what happened — one per line.',
    kind: 'list',
  },
  {
    field: 'founder_voice_samples',
    question: 'Paste one or more samples of the founder’s natural writing/speaking voice — one per line.',
    kind: 'list',
  },
];

function getPath(profile: ProductProfile, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, profile);
}

/** Set a dot-path field from a free-text answer, returning a new valid profile. */
export function applyIntakeAnswer(
  profile: ProductProfile,
  field: string,
  answer: string,
): ProductProfile {
  const q = INTAKE_QUESTIONS.find((x) => x.field === field);
  if (!q) throw new Error(`Unknown intake field "${field}".`);

  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(profile));
  const keys = field.split('.');
  let target = clone;
  for (const key of keys.slice(0, -1)) {
    target = target[key] as Record<string, unknown>;
  }
  const leaf = keys[keys.length - 1]!;

  switch (q.kind) {
    case 'text':
      target[leaf] = answer.trim();
      break;
    case 'number': {
      const digits = answer.replace(/[^0-9.]/g, '');
      const n = Number(digits);
      if (digits === '' || Number.isNaN(n)) {
        throw new Error(`Could not read a number from "${answer}".`);
      }
      target[leaf] = n;
      break;
    }
    case 'list': {
      const items = answer
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (field === 'proof_assets') {
        target[leaf] = items.map((ref) => ({ type: 'stated', ref, strength: '' }));
      } else {
        target[leaf] = items;
      }
      break;
    }
    case 'choice': {
      const v = answer.trim().toLowerCase();
      if (!q.choices?.includes(v)) {
        throw new Error(`Answer must be one of: ${q.choices?.join(', ')}.`);
      }
      target[leaf] = v;
      break;
    }
  }
  return productProfileSchema.parse(clone);
}

/**
 * The questions still unanswered for this profile — the adaptive flow asks
 * ONLY these (WO-009 acceptance).
 *
 * A field is unanswered when its value is empty AND it hasn't been explicitly
 * answered this interview (`answered`). `compliance_mode` needs the explicit
 * set: its contract default is `'none'` (a legitimate answer), so value alone
 * can't distinguish "not asked yet" from "answered none" — it stays in the
 * queue until explicitly answered, then never reappears.
 */
export function unansweredProfileFields(
  profile: ProductProfile,
  answered: ReadonlySet<string> = new Set(),
): IntakeQuestion[] {
  return INTAKE_QUESTIONS.filter((q) => {
    if (answered.has(q.field)) return false;
    const v = getPath(profile, q.field);
    if (q.field === 'constraints.compliance_mode') return true; // until explicitly answered
    return isEmptyValue(v);
  });
}
