// 今すぐ実行（スケジュールは変えない）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { runRule } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  try {
    const created = await runRule(id);
    await prisma.automationRule.update({ where: { id }, data: { executionCount: { increment: 1 }, lastExecutedAt: new Date(), lastError: null } });
    return NextResponse.json({ ok: true, created });
  } catch (e) {
    await prisma.automationRule.update({ where: { id }, data: { lastExecutedAt: new Date(), lastError: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
});
