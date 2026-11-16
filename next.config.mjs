/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Don't bundle the native sqlite module: keep it external so its .node binary loads.
  serverExternalPackages: ["better-sqlite3"],

  // Every image is a plain <img>, so the optimiser never runs and the excludes below can drop sharp (34 MB).
  images: { unoptimized: true },
  // Traced into the standalone output but never loaded at runtime: sharp, and TypeScript (only `next dev` uses it).
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/typescript/**",
    ],
  },

  // Cache-Control for the Cloudflare edge (`s-maxage`) and the visitor's disk (`max-age`). Only static files may be kept.
  async headers() {
    const noStore = [{ key: "Cache-Control", value: "no-store" }];
    const unversionedAsset = [
      {
        key: "Cache-Control",
        value:
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    ];
    return [
      {
        // Gmail's proxy refetches this per recipient; the URL carries `?v=N` (LOGO_VERSION in email.ts), so a year is safe.
        source: "/logo-mark.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=31536000, immutable",
          },
        ],
      },
      // Unversioned, so a day at the edge and a background refresh after it.
      { source: "/logo.svg", headers: unversionedAsset },
      { source: "/favicon.png", headers: unversionedAsset },
      // Stated explicitly so a broad "cache everything" rule at Cloudflare can't serve one admin's dashboard to another.
      { source: "/", headers: noStore },
      { source: "/dashboard/:path*", headers: noStore },
      { source: "/login", headers: noStore },
      { source: "/api/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
