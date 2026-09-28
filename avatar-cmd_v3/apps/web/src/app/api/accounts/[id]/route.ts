import { NextResponse } from "next/server";
import { deleteAccount, updateAccountSettings } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { settings, isActive, clearError } = (await req.json()) as { settings?: Record<string, unknown>; isActive?: boolean; clearError?: boolean };
  // 「直近のエラー」を確認済みにする（履歴はアクティビティに残る）
  if (clearError) await prisma.snsAccount.update({ where: { id }, data: { lastError: null } });
  if (settings || isActive !== undefined) await updateAccountSettings(id, settings ?? {}, isActive);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await deleteAccount(id);
  await prisma.auditLog.create({ data: { action: "credential_deleted", resource: "sns_account", resourceId: id } });
  return NextResponse.json({ ok: true });
});
