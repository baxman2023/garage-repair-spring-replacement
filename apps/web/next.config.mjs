/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is run at the monorepo root via `pnpm lint` (flat config).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
