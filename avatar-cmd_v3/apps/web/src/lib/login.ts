// ログイン成功時の共通処理: サーバー側のセッションを作り、署名付きの Cookie を付ける
// SameSite は lax（strict だと SNS の認可画面から戻ったときに Cookie が送られず、ログイン画面に戻されるため）。
// 他サイトからの書き込みは Origin / Sec-Fetch-Site で断っている（lib/session.ts の crossSiteWrite）
import { NextResponse } from "next/server";
import { createAdminSession, type ClientInfo } from "@avatar-cmd/integrations/server";
import { createSessionToken, SESSION_COOKIE } from "./session";

export function isHttps(req: Request) {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

export async function startSession(req: Request, client: ClientInfo, res: NextResponse) {
  const { sid, expiresAt } = await createAdminSession(client);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(sid, expiresAt.getTime()), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    expires: expiresAt,
  });
  return res;
}

export function clearSession(req: Request, res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: isHttps(req), path: "/", maxAge: 0 });
  return res;
}
