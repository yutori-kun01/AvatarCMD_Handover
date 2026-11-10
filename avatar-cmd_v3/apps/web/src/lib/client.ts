// 接続元の IP とブラウザ（ログインの回数制限・ログイン履歴用）
// ・IP は X-Forwarded-For の右端（いちばん近いプロキシ＝Traefik が付けた値）を使う。
//   Next.js は X-Forwarded-For が無いときだけ接続元の IP を入れるため、プロキシを通さず公開していると偽装できる。
//   その場合でも総当たりできないよう、回数制限には「全体の失敗回数」も使っている（admin-security.ts）。
import type { ClientInfo } from "@avatar-cmd/integrations/server";

export function clientInfo(req: Request): ClientInfo {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop() || req.headers.get("x-real-ip") || "unknown";
  return { ip: ip.slice(0, 64), userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null };
}
