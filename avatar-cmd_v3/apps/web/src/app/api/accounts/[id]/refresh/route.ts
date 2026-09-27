// トークンを今すぐ更新する
import { NextResponse } from "next/server";
import { refreshAccountNow } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const r = await refreshAccountNow(id);
  await prisma.auditLog.create({ data: { action: "credential_refreshed", resource: "sns_account", resourceId: id } });
  return NextResponse.json({ ok: true, ...r });
});
