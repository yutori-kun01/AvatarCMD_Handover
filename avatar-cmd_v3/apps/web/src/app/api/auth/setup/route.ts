// 初回セットアップ: 管理者パスワードが未設定のときだけ、ログイン画面から設定できる。
// 本番（NODE_ENV=production）では .env の ADMIN_PASSWORD を必須とし、この経路は無効。
import { NextResponse } from "next/server";
import { passwordConfigured, setPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  if (process.env.NODE_ENV === "production" || (await passwordConfigured())) {
    return NextResponse.json({ error: "セットアップは完了しています" }, { status: 403 });
  }
  const { password } = (await req.json()) as { password: string };
  await setPassword(password ?? "");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  return res;
});
