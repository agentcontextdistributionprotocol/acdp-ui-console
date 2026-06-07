import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image ships only the server + the node_modules it actually uses.
  output: 'standalone',
};

export default nextConfig;
