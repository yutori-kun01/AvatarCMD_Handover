// 収益の記録と集計。各SNSの収益APIは提供範囲が限られるため、記録は手入力（またはAPI経由）で行う
// アイテム（記事・商品）を選ぶと、アバター・アカウント・単価を引き継いで「数量 × 単価」で記録する
import { NextResponse } from "next/server";
import { recordRevenue, revenueReport, type RevenueInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json(await revenueReport()));

export const POST = route(async (req: Request) => {
  const r = await recordRevenue((await req.json()) as RevenueInput);
  return NextResponse.json({ ok: true, id: r.id });
});
