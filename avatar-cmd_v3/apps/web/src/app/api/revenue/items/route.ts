// 収益アイテム（記事・商品など）: 単価付きで登録しておき、収益の記録時に選ぶだけにする
import { NextResponse } from "next/server";
import { listRevenueItems, saveRevenueItem, type RevenueItemInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ items: await listRevenueItems() }));

export const POST = route(async (req: Request) => {
  const item = await saveRevenueItem((await req.json()) as RevenueItemInput);
  return NextResponse.json({ ok: true, id: item.id });
});
