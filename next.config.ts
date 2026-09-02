import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {},
  compress: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },

  // Categories became a child of Stock Management and moved /more/categories -> /categories
  // so its URL matches its place in the tree (beside /product-types). Nothing in src/ linked
  // to the old path, but it was reachable from the More menu for months, so bookmarks exist.
  //
  // A config redirect rather than a page that calls redirect(): this answers 308 at the edge
  // with no route entry, no React bundle and no flash of a loading shell.
  async redirects() {
    return [
      { source: "/more/categories", destination: "/categories", permanent: true },
    ];
  },
};

export default nextConfig;
