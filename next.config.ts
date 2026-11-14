import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Plain dynamic rendering: every page reads live data from Supabase.
  cacheComponents: false,
  // mppx lazily imports optional peers (MCP, x402) that the bundler cannot resolve.
  serverExternalPackages: ["mppx", "pg", "viem"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
