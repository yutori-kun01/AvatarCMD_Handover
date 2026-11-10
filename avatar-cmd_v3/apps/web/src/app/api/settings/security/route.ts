// 設定 > セキュリティ: 2 段階認証・ログイン中の端末・ログイン履歴
// GET: 状態 / POST: { action: "totp_begin" | "totp_confirm" | "totp_disable" | "revoke_others", ... }
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import {
  beginTotpSetup,
  confirmTotpSetup,
  disableTotp,
  listAdminSessions,
  listSecurityEvents,
  remainingRecoveryCodes,
  revokeAllAdminSessions,
  securityAudit,
  SECURITY_RULES,
  totpEnabled,
  verifySecondFactor,
} from "@avatar-cmd/integrations/server";
import { ConfigError } from "@avatar-cmd/integrations";
import { checkPassword } from "@/lib/auth";
import { clientInfo } from "@/lib/client";
import { sessionId } from "@/lib/guard";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function describe(req: Request) {
  const sid = (await sessionId(req)) ?? undefined;
  const enabled = await totpEnabled();
  return {
    totp: { enabled, recoveryCodesLeft: enabled ? await remainingRecoveryCodes() : 0 },
    sessions: await listAdminSessions(sid),
    events: await listSecurityEvents(50),
    rules: { perIpFailures: SECURITY_RULES.perIpFailures, globalFailures: SECURITY_RULES.globalFailures, windowMinutes: SECURITY_RULES.windowMs / 60_000, idleHours: SECURITY_RULES.idleMs / 3600_000, sessionDays: SECURITY_RULES.sessionTtlMs / 86400_000 },
  };
}

export const GET = route(async (req: Request) => NextResponse.json(await describe(req)));

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { action?: string; code?: string; password?: string };
  const client = clientInfo(req);
  switch (b.action) {
    case "totp_begin": {
      const { secret, uri } = await beginTotpSetup();
      const qr = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
      return NextResponse.json({ secret, uri, qr });
    }
    case "totp_confirm": {
      const { recoveryCodes } = await confirmTotpSetup(String(b.code ?? ""), client);
      return NextResponse.json({ recoveryCodes, ...(await describe(req)) });
    }
    case "totp_disable": {
      // 無効にするにはパスワードと、いまのコード（または回復コード）の両方が必要
      if (!(await checkPassword(String(b.password ?? "")))) throw new ConfigError("パスワードが違います");
      if (!(await verifySecondFactor(String(b.code ?? ""), client))) throw new ConfigError("確認コードが違います");
      await disableTotp(client);
      return NextResponse.json(await describe(req));
    }
    case "revoke_others": {
      const n = await revokeAllAdminSessions((await sessionId(req)) ?? undefined);
      await securityAudit("sessions_revoked", client, { count: n });
      return NextResponse.json({ revoked: n, ...(await describe(req)) });
    }
    default:
      throw new ConfigError("action が不正です");
  }
});
