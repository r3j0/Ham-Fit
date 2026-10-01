import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Keep validation builds separate from an already running development server.
  distDir: process.env.NEXT_BUILD_DIR ?? ".next",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://ham-fit-api.vercel.app/api/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default nextConfig;
