// 管理者ログイン: パスワード（＋2 段階認証が有効なら 6 桁のコードか回復コード）
// ・同じ IP の失敗が続いたとき、全体の失敗が多いときは一時停止する（admin-security.ts）。停止中はパスワードを確かめない。
// ・成功・失敗・停止はログイン履歴（AuditLog）に IP・ブラウザ付きで残す。
import { NextResponse } from "next/server";
import { loginBlockReason, recordLoginAttempt, securityAudit, SECURITY_RULES, totpEnabled, verifySecondFactor } from "@avatar-cmd/integrations/server";
import { checkPassword, passwordConfigured } from "@/lib/auth";
import { clientInfo } from "@/lib/client";
import { startSession } from "@/lib/login";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET = route(async () => {
  return NextResponse.json({ configured: await passwordConfigured(), setupAllowed: process.env.NODE_ENV !== "production" });
});

export const POST = route(async (req: Request) => {
  const client = clientInfo(req);
  const blocked = await loginBlockReason(client.ip);
  if (blocked) {
    await securityAudit("login_blocked", client, { scope: blocked });
    const minutes = Math.round(SECURITY_RULES.windowMs / 60_000);
    return NextResponse.json(
      { error: blocked === "ip" ? `ログインの失敗が続いたため、${minutes} 分ほど受け付けを止めています` : `ログインの失敗が多いため、${minutes} 分ほどすべてのログインを止めています（不正なアクセスの可能性があります）` },
      { status: 429, headers: { "retry-after": String(SECURITY_RULES.windowMs / 1000) } },
    );
  }
  const { password, code } = (await req.json().catch(() => ({}))) as { password?: string; code?: string };
  if (!password || typeof password !== "string" || password.length > 200 || !(await checkPassword(password))) {
    await recordLoginAttempt(client.ip, false, "password");
    await securityAudit("login_failed", client, { reason: "password" });
    await sleep(1000);
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }
  if (await totpEnabled()) {
    if (!code) return NextResponse.json({ needCode: true });
    if (typeof code !== "string" || !(await verifySecondFactor(code, client))) {
      await recordLoginAttempt(client.ip, false, "totp");
      await securityAudit("login_failed", client, { reason: "totp" });
      await sleep(1000);
      return NextResponse.json({ error: "確認コードが違います", needCode: true }, { status: 401 });
    }
  }
  await recordLoginAttempt(client.ip, true);
  await securityAudit("login_success", client);
  return startSession(req, client, NextResponse.json({ ok: true }));
});
