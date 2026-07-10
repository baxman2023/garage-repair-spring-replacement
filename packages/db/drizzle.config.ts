import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required for drizzle-kit (set it in the repo-root .env).');
}

export default defineConfig({
  dialect: 'mysql',
  // Point at the compiled CJS schema bundle (run `pnpm build` first). Feeding
  // TS source under a `type: module` package makes drizzle-kit's loader inject
  // `require` into ESM scope and fail; the prebuilt .cjs sidesteps that.
  schema: './dist/schema/index.cjs',
  out: './drizzle',
  dbCredentials: { url },
  casing: 'snake_case',
});
