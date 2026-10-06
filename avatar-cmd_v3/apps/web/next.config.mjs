import { existsSync } from "fs";
import { resolve } from "path";

// ローカル開発ではモノレポ直下の .env を読み込む（Docker では compose が環境変数を渡す）
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Docker multi-stage build に必要
  transpilePackages: ["@avatar-cmd/db", "@avatar-cmd/integrations"],
  serverExternalPackages: ["@prisma/client", "@atproto/api", "@resvg/resvg-js"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../../"),
  // 図解のアイコン（SVG ファイルを実行時に読む）と resvg のネイティブモジュールを standalone 出力に含める
  outputFileTracingIncludes: {
    "/api/**": [
      "../../node_modules/.pnpm/bootstrap-icons@*/node_modules/bootstrap-icons/icons/*.svg",
      "../../node_modules/.pnpm/lucide-static@*/node_modules/lucide-static/icons/*.svg",
      "../../node_modules/.pnpm/@resvg+resvg-js-*/node_modules/@resvg/**",
    ],
  },
  // v3.7 — 画面の統合（旧 URL は統合先へ）
  async redirects() {
    return [
      { source: "/sns", destination: "/settings?tab=platforms", permanent: false },
      { source: "/costs", destination: "/settings?tab=costs", permanent: false },
      { source: "/youtube", destination: "/knowledge?tab=youtube", permanent: false },
      { source: "/activity", destination: "/dashboard#activity", permanent: false },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
