import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Plain dynamic rendering: every page reads live data from Supabase.
  cacheComponents: false,
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
