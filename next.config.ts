import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loyiha papkasini aniq belgilash — yuqori papkada boshqa lockfile bo'lsa
  // ("multiple lockfiles" ogohlantirishi) Next.js ildizni noto'g'ri aniqlamasligi uchun
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
