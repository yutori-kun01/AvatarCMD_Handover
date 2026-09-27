import { NextResponse } from "next/server";
import { checkPassword, passwordConfigured } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const GET = route(async () => {
  return NextResponse.json({ configured: await passwordConfigured(), setupAllowed: process.env.NODE_ENV !== "production" });
});

export const POST = route(async (req: Request) => {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 1000)); // 総当たり対策
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
});
