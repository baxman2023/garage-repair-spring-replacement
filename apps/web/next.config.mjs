import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import createMDX from '@next/mdx';

// Load the repo-root .env at server boot (dev/staging). Next.js only reads
// env files from the app directory on its own, and the shared packages read
// process.env lazily — without this, `next start` cannot see DATABASE_URL.
// dotenv never overrides variables a real environment (PM2) already set.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Contextual docs render from .mdx pages (WO-054).
  pageExtensions: ['ts', 'tsx', 'mdx'],
  eslint: {
    // Linting is run at the monorepo root via `pnpm lint` (flat config).
    ignoreDuringBuilds: true,
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
