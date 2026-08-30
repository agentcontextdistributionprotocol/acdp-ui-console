import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image ships only the server + the node_modules it actually uses.
  // Skip it on Vercel: Vercel's own builder already produces an optimized
  // deployment bundle, and `output: 'standalone'` collides with its
  // `onBuildComplete` packaging step under Next.js 16.3.x — the build
  // completes but packaging then fails with
  // "ENOENT: .next/next-server.js.nft.json" (open as of 2026-08-21:
  // https://community.vercel.com/t/next-js-16-3-1-preview-packaging-fails-in-onbuildcomplete-with-missing-next-server-js-nft-json/48121).
  // Next.js's own docs already say standalone isn't needed on Vercel for
  // this reason.
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
};

export default nextConfig;
