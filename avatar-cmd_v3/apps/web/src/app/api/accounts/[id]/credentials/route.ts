// アカウントの認証情報の状態（秘密の値は伏せ字）
import { NextResponse } from "next/server";
import { describeAccountCredentials } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const info = await describeAccountCredentials(id);
  await prisma.auditLog.create({ data: { action: "credential_accessed", resource: "sns_account", resourceId: id } });
  return NextResponse.json(info);
});
