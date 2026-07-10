import { z } from 'zod';

/**
 * Environment schema (spec §9). Validated with zod.
 *
 * Validation is *lazy*: the parsed object is produced on first property
 * access via {@link env}, and memoized. This keeps `next build` and other
 * tooling from crashing when secrets are absent, while any runtime code path
 * that actually reads a variable gets a hard, actionable failure if the
 * environment is misconfigured. Call {@link assertEnv} at process boot
 * (worker/cli) to fail fast on startup.
 */

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');

const envSchema = z
  .object({
    // --- Core (required) ---
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    // 32-byte key material for AES-256-GCM (hex=64 chars or base64). We only
    // enforce a sane minimum length here; the vault (WO-005) decodes/validates.
    MASTER_KEY: z.string().min(32, 'MASTER_KEY must be at least a 32-byte key'),

    // --- App ---
    APP_NAME: z.string().min(1).default('CopyForge'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    NODE_ENV: nodeEnv,

    // --- Worker ---
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),

    // --- Magic-link email transport (WO-003) ---
    EMAIL_HOST: z.string().optional(),
    EMAIL_PORT: z.coerce.number().int().positive().default(587),
    EMAIL_USER: z.string().optional(),
    EMAIL_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('CopyForge <no-reply@example.com>'),

    // --- Stripe (WO-051) ---
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_LICENSE: z.string().optional(),
    STRIPE_PRICE_GENOME_FEED: z.string().optional(),

    // --- Observability (WO-056) ---
    SENTRY_DSN: z.string().optional(),

    // --- Local dev only (spec §9): never a production key path ---
    DEV_ANTHROPIC_KEY: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === 'production' && val.DEV_ANTHROPIC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_ANTHROPIC_KEY'],
        message: 'DEV_ANTHROPIC_KEY must not be set when NODE_ENV=production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function parseEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Validate the environment eagerly and return it. Call at process boot.
 * Throws with a readable list of problems if anything is invalid.
 */
export function assertEnv(): Env {
  return parseEnv();
}

/** Reset the memoized env. Test-only. */
export function __resetEnvCache(): void {
  cached = null;
}

/**
 * Lazily-validated environment. Accessing any property triggers validation
 * on first use and caches the result.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string | symbol) {
    return parseEnv()[prop as keyof Env];
  },
  has(_target, prop) {
    return prop in parseEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(parseEnv() as object);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(parseEnv(), prop);
  },
});
