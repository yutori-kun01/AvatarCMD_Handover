// ログアウト: このブラウザのセッションを DB で失効させる（Cookie を盗まれていても使えなくなる）
import { NextResponse } from "next/server";
import { revokeAdminSession, securityAudit } from "@avatar-cmd/integrations/server";
import { clientInfo } from "@/lib/client";
import { sessionId } from "@/lib/guard";
import { clearSession } from "@/lib/login";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const sid = await sessionId(req);
  if (sid) {
    await revokeAdminSession(sid);
    await securityAudit("logout", clientInfo(req));
  }
  return clearSession(req, NextResponse.json({ ok: true }));
});
