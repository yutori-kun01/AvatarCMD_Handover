import { resolve } from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Docker multi-stage build に必要
  transpilePackages: ["@avatar-cmd/core", "@avatar-cmd/db", "@avatar-cmd/integrations"],
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bullmq", "ioredis", "@google/genai"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../../"),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
