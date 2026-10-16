/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Top-level `turbopack` replaces the deprecated `experimental.turbo` (Next.js >= 15.3).
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json']
  }
};

export default nextConfig;
