// API クレジット不足で一時停止したアカウントの自動化を再開する
import { NextResponse } from "next/server";
import { resumeAccountAutomation } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const r = await resumeAccountAutomation(id);
  if (r.resumed) await prisma.auditLog.create({ data: { action: "automation_resumed", resource: "sns_account", resourceId: id } });
  return NextResponse.json({ ok: true, ...r });
});
