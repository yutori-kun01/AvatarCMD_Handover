// 収益の記録と集計。各SNSの収益APIは提供範囲が限られるため、記録は手入力（またはAPI経由）で行う
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { revenueReport } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json(await revenueReport()));

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as {
    avatarId: string; source: string; platform: string; amount: number | string; currency?: string; description?: string; earnedAt?: string;
  };
  const amount = Number(b.amount);
  if (!b.avatarId) return NextResponse.json({ error: "アバターを選択してください" }, { status: 400 });
  if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: "金額を入力してください" }, { status: 400 });
  if (!b.source?.trim() || !b.platform?.trim()) return NextResponse.json({ error: "収益源とプラットフォームを入力してください" }, { status: 400 });
  const earnedAt = b.earnedAt ? new Date(b.earnedAt) : new Date();
  if (Number.isNaN(earnedAt.getTime())) return NextResponse.json({ error: "日付が不正です" }, { status: 400 });
  const r = await prisma.revenue.create({
    data: {
      avatarId: b.avatarId,
      source: b.source.trim(),
      platform: b.platform.trim(),
      amount,
      currency: b.currency?.trim() || "JPY",
      description: b.description?.trim() || null,
      earnedAt,
    },
  });
  return NextResponse.json({ ok: true, id: r.id });
});
