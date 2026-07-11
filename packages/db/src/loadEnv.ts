import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Load the repo-root `.env` for DB tooling (migrate/seed) run outside the app
 * processes. Must be called before importing anything that reads `env`.
 * The repo root is three levels up from this file (src|dist → db → packages → root).
 *
 * dotenv is required lazily via createRequire so the library bundle carries
 * no CJS interop shim at module scope — plain-node consumers of the ESM dist
 * broke on it (found by the WO-056 load test).
 */
export function loadRootEnv(): void {
  const require = createRequire(import.meta.url);
  const { config } = require('dotenv') as typeof import('dotenv');
  const here = dirname(fileURLToPath(import.meta.url));
  config({ path: resolve(here, '../../../.env') });
}
