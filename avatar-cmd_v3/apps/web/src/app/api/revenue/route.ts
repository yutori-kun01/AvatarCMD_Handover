// 収益の記録と集計。各SNSの収益APIは提供範囲が限られるため、記録は手入力（またはAPI経由）で行う
// アイテム（記事・商品）を選ぶと、アバター・アカウント・単価を引き継いで「数量 × 単価」で記録する
import { NextResponse } from "next/server";
import { recordRevenue, revenueReport, type RevenueInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await revenueReport({ months: q.has("months") ? Number(q.get("months")) : null, avatarId: q.get("avatarId"), source: q.get("source"), platform: q.get("platform") }));
});

export const POST = route(async (req: Request) => {
  const r = await recordRevenue((await req.json()) as RevenueInput);
  return NextResponse.json({ ok: true, id: r.id });
});
