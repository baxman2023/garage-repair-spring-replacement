import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Load the repo-root `.env` for DB tooling (migrate/seed) run outside the app
 * processes. Must be called before importing anything that reads `env`.
 * The repo root is three levels up from this file (src|dist → db → packages → root).
 */
export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  config({ path: resolve(here, '../../../.env') });
}
