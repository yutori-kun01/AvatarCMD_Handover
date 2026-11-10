// 管理者パスワードの変更: 現在のパスワード（＋2 段階認証が有効ならコード）が必要。変更したら他の端末のログインをすべて失効させる
import { NextResponse } from "next/server";
import { revokeAllAdminSessions, securityAudit, totpEnabled, verifySecondFactor } from "@avatar-cmd/integrations/server";
import { checkPassword, setPassword } from "@/lib/auth";
import { clientInfo } from "@/lib/client";
import { sessionId } from "@/lib/guard";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const { current, next, code } = (await req.json()) as { current: string; next: string; code?: string };
  const client = clientInfo(req);
  if (!(await checkPassword(current ?? ""))) return NextResponse.json({ error: "現在のパスワードが違います" }, { status: 400 });
  if ((await totpEnabled()) && !(await verifySecondFactor(code ?? "", client))) return NextResponse.json({ error: "2 段階認証のコードが違います" }, { status: 400 });
  await setPassword(next ?? "");
  const revoked = await revokeAllAdminSessions((await sessionId(req)) ?? undefined);
  await securityAudit("password_changed", client, { revokedSessions: revoked });
  return NextResponse.json({ ok: true, revokedSessions: revoked });
});
