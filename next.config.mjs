/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Don't bundle the native sqlite module: keep it external so its .node binary loads.
  serverExternalPackages: ["better-sqlite3"],

  // Cache-Control for the Cloudflare edge, so asset traffic stops waking the
  // Fly machine. `s-maxage` is what the CDN honours; `max-age` governs the
  // visitor's own disk. Every screen here sits behind the session cookie, so
  // the static files are the only thing the edge may keep.
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
        // Gmail's image proxy refetches this per recipient, and the URL carries
        // `?v=N` from email.ts (bump LOGO_VERSION when the file changes), so a
        // year at the edge costs nothing and can't serve stale artwork.
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
      { source: "/favicon.ico", headers: unversionedAsset },
      { source: "/favicon.png", headers: unversionedAsset },
      // Never cacheable, stated explicitly so a broad "cache everything" rule at
      // Cloudflare can't ever serve one admin's dashboard to somebody else.
      { source: "/", headers: noStore },
      { source: "/dashboard/:path*", headers: noStore },
      { source: "/login", headers: noStore },
      { source: "/api/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
