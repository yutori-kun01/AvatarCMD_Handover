// 初回セットアップ: 管理者パスワードが未設定のときだけ、ログイン画面から設定できる。
// 本番（NODE_ENV=production）では .env の ADMIN_PASSWORD を必須とし、この経路は無効。
import { NextResponse } from "next/server";
import { recordLoginAttempt, securityAudit } from "@avatar-cmd/integrations/server";
import { passwordConfigured, setPassword } from "@/lib/auth";
import { clientInfo } from "@/lib/client";
import { startSession } from "@/lib/login";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  if (process.env.NODE_ENV === "production" || (await passwordConfigured())) {
    return NextResponse.json({ error: "セットアップは完了しています" }, { status: 403 });
  }
  const { password } = (await req.json()) as { password: string };
  await setPassword(password ?? "");
  const client = clientInfo(req);
  await recordLoginAttempt(client.ip, true, "setup");
  await securityAudit("password_changed", client, { via: "setup" });
  return startSession(req, client, NextResponse.json({ ok: true }));
});
