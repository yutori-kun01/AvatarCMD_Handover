// 自動化ルール: 「AIで投稿文を生成 → 下書き（承認待ち）or 自動投稿」を定期実行
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { nextRunAfter, validateAction, validateTrigger, type ActionConfig, type TriggerConfig } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const rules = await prisma.automationRule.findMany({ orderBy: { createdAt: "asc" }, include: { avatar: { select: { name: true } } } });
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
    })),
  });
});

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; name: string; description?: string; trigger: TriggerConfig; action: ActionConfig };
  if (!b.name?.trim()) return NextResponse.json({ error: "ルール名を入力してください" }, { status: 400 });
  const trigger = validateTrigger(b.trigger);
  const action = validateAction(b.action);
  const accounts = await prisma.snsAccount.findMany({ where: { id: { in: action.accountIds } } });
  if (accounts.some((a) => a.avatarId !== b.avatarId)) return NextResponse.json({ error: "選択したアカウントはこのアバターのものではありません" }, { status: 400 });
  const rule = await prisma.automationRule.create({
    data: {
      avatarId: b.avatarId,
      name: b.name.trim(),
      description: b.description?.trim() || null,
      category: "posting",
      triggerType: "schedule",
      triggerConfig: trigger as object,
      actionType: "generate_post",
      actionConfig: action as object,
      nextRunAt: nextRunAfter(trigger, new Date()),
    },
  });
  return NextResponse.json({ ok: true, id: rule.id });
});
