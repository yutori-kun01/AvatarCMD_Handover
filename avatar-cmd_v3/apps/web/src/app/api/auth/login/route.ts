import { NextResponse } from "next/server";
import { checkPassword, passwordConfigured, sessionEpoch } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";
import { route } from "@/lib/api";
import { clientIp, lockedFor, recordFailure, recordSuccess } from "@/lib/login-limit";

export const runtime = "nodejs";

export const GET = route(async () => {
  return NextResponse.json({ configured: await passwordConfigured(), setupAllowed: process.env.NODE_ENV !== "production" });
});

export const POST = route(async (req: Request) => {
  const ip = clientIp(req);
  const wait = lockedFor(ip);
  if (wait) return NextResponse.json({ error: `ログインの失敗が続いたため、${Math.ceil(wait / 60)} 分後にもう一度お試しください` }, { status: 429, headers: { "Retry-After": String(wait) } });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await checkPassword(password))) {
    const delay = recordFailure(ip); // 総当たり対策（IP ごとのロック・全体の遅延）
    await new Promise((r) => setTimeout(r, delay));
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }
  recordSuccess(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(await sessionEpoch()), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
});
