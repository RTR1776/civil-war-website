import type { NextConfig } from "next";

// Static-export mode for GitHub Pages: NEXT_OUTPUT=export produces ./out, and
// NEXT_PUBLIC_BASE_PATH (e.g. /civil-war-website) prefixes routes and assets
// when the site is served from a subpath. Both are unset for normal dev/build.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT === "export" ? { output: "export" as const } : {}),
  basePath,
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
