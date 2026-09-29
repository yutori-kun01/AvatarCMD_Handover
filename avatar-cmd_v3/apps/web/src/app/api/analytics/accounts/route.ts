// アカウント分析（バイタルチェック）: アカウントごとの月次の投稿・エラー・収益・フォロワー・反応
import { NextResponse } from "next/server";
import { accountVitals } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await accountVitals({ month: q.get("month"), avatarId: q.get("avatarId") }));
});
