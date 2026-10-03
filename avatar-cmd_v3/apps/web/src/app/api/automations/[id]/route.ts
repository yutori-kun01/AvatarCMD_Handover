import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { queuedPostsOfRule, updateRule, type RuleInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 停止時の影響範囲: このルールで自動承認され、まだ送信されていない予約
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const rows = await queuedPostsOfRule(id);
  return NextResponse.json({
    queued: rows.map((r) => ({ id: r.id, platform: r.platform, text: r.content.slice(0, 80), scheduledAt: r.scheduledPost?.scheduledAt ?? null })),
  });
});

// 編集・停止/再開。停止時に holdQueued: true なら既存の予約も下書きに戻す
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { held } = await updateRule(id, (await req.json()) as RuleInput);
  return NextResponse.json({ ok: true, held });
});

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.automationRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
