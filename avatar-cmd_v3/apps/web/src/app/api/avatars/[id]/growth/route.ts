// アバターの各アカウントの成長フェーズ（帯・到達レベル・改善ループの設定値・自動調整の履歴）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { avatarGrowthView, evaluateAccountGrowth, GROWTH_BANDS, GROWTH_METRIC_LABEL, GROWTH_STAGE_LABEL } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function view(id: string) {
  return { accounts: await avatarGrowthView(id), bands: GROWTH_BANDS, metricLabels: GROWTH_METRIC_LABEL, stageLabels: GROWTH_STAGE_LABEL };
}

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json(await view(id));
});

// 今すぐ評価する（全アカウント、または accountId のアカウントだけ）
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { accountId?: string };
  const accounts = await prisma.snsAccount.findMany({ where: { avatarId: id, isActive: true, ...(b.accountId ? { id: b.accountId } : {}) }, select: { id: true } });
  for (const a of accounts) await evaluateAccountGrowth(a.id);
  return NextResponse.json(await view(id));
});
