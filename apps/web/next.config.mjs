import createMDX from '@next/mdx';

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
