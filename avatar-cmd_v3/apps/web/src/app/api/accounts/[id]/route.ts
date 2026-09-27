import { NextResponse } from "next/server";
import { deleteAccount, updateAccountSettings } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { settings, isActive } = (await req.json()) as { settings?: Record<string, unknown>; isActive?: boolean };
  await updateAccountSettings(id, settings ?? {}, isActive);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await deleteAccount(id);
  await prisma.auditLog.create({ data: { action: "credential_deleted", resource: "sns_account", resourceId: id } });
  return NextResponse.json({ ok: true });
});
