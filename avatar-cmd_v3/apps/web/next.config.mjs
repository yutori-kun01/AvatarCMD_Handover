import { existsSync } from "fs";
import { resolve } from "path";

// ローカル開発ではモノレポ直下の .env を読み込む（Docker では compose が環境変数を渡す）
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Docker multi-stage build に必要
  transpilePackages: ["@avatar-cmd/db", "@avatar-cmd/integrations"],
  serverExternalPackages: ["@prisma/client", "@atproto/api"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../../"),
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
