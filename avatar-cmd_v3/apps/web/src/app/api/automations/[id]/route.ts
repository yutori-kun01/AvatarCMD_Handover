import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { nextRunAfter, validateAction, validateTrigger, type ActionConfig, type TriggerConfig } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { name?: string; description?: string; isActive?: boolean; trigger?: TriggerConfig; action?: ActionConfig };
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });
  const trigger = b.trigger ? validateTrigger(b.trigger) : (rule.triggerConfig as unknown as TriggerConfig);
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name.trim() || rule.name;
  if (b.description !== undefined) data.description = b.description.trim() || null;
  if (b.trigger) data.triggerConfig = trigger;
  if (b.action) data.actionConfig = validateAction(b.action);
  if (b.isActive !== undefined) data.isActive = b.isActive;
  // 再開・スケジュール変更時は次回時刻を計算し直す
  if (b.trigger || (b.isActive && !rule.isActive)) data.nextRunAt = nextRunAfter(validateTrigger(trigger), new Date());
  if (b.isActive) data.lastError = null;
  await prisma.automationRule.update({ where: { id }, data: data as any });
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.automationRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
