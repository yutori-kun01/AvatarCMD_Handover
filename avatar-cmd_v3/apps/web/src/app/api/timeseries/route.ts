// 指標の日別推移（ダッシュボード・アバター・アカウント共通）
import { NextResponse } from "next/server";
import { parseRange, timeseries } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await timeseries({ range: parseRange(q.get("range")), avatarId: q.get("avatarId"), accountId: q.get("accountId") }));
});
