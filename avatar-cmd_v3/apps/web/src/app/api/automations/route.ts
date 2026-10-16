// 自動化ルール: 「AIで投稿文を生成 → 下書き（承認待ち）or 自動投稿」を定期実行
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { createRule, latestPerformance, ruleConflicts, type RuleInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const rules = await prisma.automationRule.findMany({ orderBy: { createdAt: "asc" }, include: { avatar: { select: { name: true } } } });
  const performance = await latestPerformance(rules.map((r) => r.id));
  const accounts = await prisma.snsAccount.findMany({ select: { id: true, accountName: true } });
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.accountName ?? id;
  return NextResponse.json({
    rules: rules.map((r) => ({
      id: r.id,
      avatarId: r.avatarId,
      avatarName: r.avatar.name,
      name: r.name,
      description: r.description,
      isActive: r.isActive,
      actionType: r.actionType,
      trigger: r.triggerConfig,
      action: r.actionConfig,
      executionCount: r.executionCount,
      lastExecutedAt: r.lastExecutedAt,
      nextRunAt: r.nextRunAt,
      lastError: r.lastError,
      performance: performance[r.id] ?? null,
      // 同じアカウントに投稿する他の有効なルールとの重なり（停止中のルールは対象外）
      warnings: r.isActive ? ruleConflicts(r, rules.filter((o) => o.avatarId === r.avatarId), accountName) : [],
    })),
  });
});

export const POST = route(async (req: Request) => {
  const rule = await createRule((await req.json()) as RuleInput);
  return NextResponse.json({ ok: true, id: rule.id, warnings: rule.warnings, xPolicyUpdated: rule.xPolicyUpdated });
});
