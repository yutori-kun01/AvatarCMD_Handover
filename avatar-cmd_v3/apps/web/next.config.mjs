import { existsSync } from "fs";
import { resolve } from "path";

// ローカル開発ではモノレポ直下の .env を読み込む（Docker では compose が環境変数を渡す）
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// ブラウザ向けのセキュリティヘッダー
// ・CSP: 読み込み先を自分のサイトに絞る。Next.js の初期化スクリプトがインラインのため script-src に 'unsafe-inline' が要る
//   （開発時のみ 'unsafe-eval' も）。画像は SNS のプロフィール画像・ブログの画像があるため https: を許可する。
// ・他サイトへの埋め込み禁止（クリックジャッキング対策）、HTTPS の強制（HSTS）、MIME の推測禁止、リファラーの制限、
//   カメラ・マイク・位置情報などの無効化
const isDev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Docker multi-stage build に必要
  // サーバーの種類（Next.js）を応答ヘッダーで教えない
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // API の応答（個人情報・設定を含む）はブラウザや途中のプロキシに保存させない
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
  transpilePackages: ["@avatar-cmd/db", "@avatar-cmd/integrations"],
  serverExternalPackages: ["@prisma/client", "@atproto/api", "@resvg/resvg-js", "sharp", "jsdom"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../../"),
  // 図解のアイコン（SVG ファイルを実行時に読む）と resvg のネイティブモジュールを standalone 出力に含める
  outputFileTracingIncludes: {
    "/api/**": [
      "../../node_modules/.pnpm/bootstrap-icons@*/node_modules/bootstrap-icons/icons/*.svg",
      "../../node_modules/.pnpm/lucide-static@*/node_modules/lucide-static/icons/*.svg",
      "../../node_modules/.pnpm/@resvg+resvg-js-*/node_modules/@resvg/**",
      "../../node_modules/.pnpm/@img+sharp-*/node_modules/@img/**",
    ],
  },
  // v3.7 — 画面の統合（旧 URL は統合先へ）
  async redirects() {
    return [
      { source: "/sns", destination: "/settings?tab=platforms", permanent: false },
      { source: "/costs", destination: "/settings?tab=costs", permanent: false },
      { source: "/youtube", destination: "/knowledge?tab=youtube", permanent: false },
      { source: "/rss", destination: "/knowledge?tab=rss", permanent: false },
      { source: "/activity", destination: "/dashboard#activity", permanent: false },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
