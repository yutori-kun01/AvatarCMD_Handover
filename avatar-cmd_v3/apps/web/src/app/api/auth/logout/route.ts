import { NextResponse } from "next/server";
import { bumpSessionEpoch, sessionEpoch } from "@/lib/auth";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

// { all: true } なら、すべての端末のセッションを無効にする（ログイン中の本人だけが実行できる）
export async function POST(req: Request) {
  const { all } = (await req.json().catch(() => ({}))) as { all?: boolean };
  if (all) {
    const token = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
    if (!(await verifySessionToken(token ? decodeURIComponent(token) : undefined, await sessionEpoch()))) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    await bumpSessionEpoch();
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
