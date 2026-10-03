import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { validatePrice, type PriceInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 料金表に単価を追加する（人が各社の料金ページで確認して登録する。適用日で切り替わる）
export const POST = route(async (req: Request) => {
  const p = await prisma.priceEntry.create({ data: validatePrice((await req.json()) as PriceInput) });
  return NextResponse.json({ ok: true, id: p.id });
});
