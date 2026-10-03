// API 費用: 設定からの月額試算・実績に基づく概算・月末予測・予算の状態・料金表（いずれも概算で、請求確定額ではない）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { budgetStatus, estimateMonthly, forecastMonth, loadPrices } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const now = new Date();
  const [budget, estimate, forecast, prices, avatars] = await Promise.all([
    budgetStatus(now),
    estimateMonthly(now),
    forecastMonth(now),
    loadPrices(),
    prisma.avatar.findMany({ select: { id: true, name: true } }),
  ]);
  return NextResponse.json({ budget, estimate, forecast, prices, avatars });
});
