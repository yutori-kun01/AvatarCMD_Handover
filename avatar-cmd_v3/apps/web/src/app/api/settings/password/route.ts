import { NextResponse } from "next/server";
import { checkPassword, sessionEpoch, setPassword } from "@/lib/auth";
import { route } from "@/lib/api";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const { current, next } = (await req.json()) as { current: string; next: string };
  if (!(await checkPassword(current ?? ""))) return NextResponse.json({ error: "現在のパスワードが違います" }, { status: 400 });
  await setPassword(next ?? "");
  // 他の端末のセッションは無効になる。この端末はログインしたままにする
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
