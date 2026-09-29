import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { saveRevenueItem, type RevenueItemInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const cur = await prisma.revenueItem.findUniqueOrThrow({ where: { id } });
  const b = (await req.json()) as Partial<RevenueItemInput>;
  await saveRevenueItem(
    {
      avatarId: cur.avatarId,
      snsAccountId: b.snsAccountId !== undefined ? b.snsAccountId : cur.snsAccountId,
      name: b.name ?? cur.name,
      source: b.source ?? cur.source,
      platform: b.platform ?? cur.platform,
      unitPrice: b.unitPrice ?? cur.unitPrice,
      url: b.url !== undefined ? b.url : cur.url,
      isActive: b.isActive,
    },
    id
  );
  return NextResponse.json({ ok: true });
});

// 記録済みの収益は残す（アイテムとの紐付けだけ外れる）
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.revenueItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
