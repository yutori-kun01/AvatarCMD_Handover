// note 記事カレンダー: 作成予定・公開予定・保留中・公開済み（今日から days 日先まで）
import { NextResponse } from "next/server";
import { articleCalendar } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 28));
  return NextResponse.json({ items: await articleCalendar({ days }) });
});
