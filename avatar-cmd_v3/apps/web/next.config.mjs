import { resolve } from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Docker multi-stage build に必要
  transpilePackages: ["@avatar-cmd/core", "@avatar-cmd/db"],
  serverExternalPackages: ["@prisma/client"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../../"),
};

export default nextConfig;
