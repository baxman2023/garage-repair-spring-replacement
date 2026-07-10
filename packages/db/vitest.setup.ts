import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the repo-root .env so DB-backed tests can reach MariaDB.
const dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(dir, '../../.env') });
