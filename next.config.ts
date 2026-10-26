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
  // gramjs (telegram) — katta Node-only paket (TCP/WS, BigInt); bundler'ga
  // kiritilmaydi, runtime'da to'g'ridan-to'g'ri require qilinadi
  serverExternalPackages: ["telegram"],
};

export default nextConfig;
