// 最近の引用候補（判定結果・除外理由つき）
import { NextResponse } from "next/server";
import { listQuoteCandidates } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const avatarId = new URL(req.url).searchParams.get("avatarId") ?? undefined;
  return NextResponse.json({ candidates: await listQuoteCandidates(avatarId) });
});
