import type { NextConfig } from "next";

// The browser only talks to this Next server; /api/* is forwarded to the FastAPI backend,
// so no CORS setup is needed. Rewrites are resolved when the app is built, so API_URL must
// also be set at build time for a standalone (Docker) build.
const apiUrl = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
