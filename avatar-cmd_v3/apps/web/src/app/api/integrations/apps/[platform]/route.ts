// 開発者アプリ情報（Client ID / Secret 等）の保存。秘密の値は空欄なら既存値を維持
import { NextResponse } from "next/server";
import { getPlatform } from "@avatar-cmd/integrations";
import { describePlatformApp, savePlatformApp } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PUT = route(async (req: Request, { params }: { params: Promise<{ platform: string }> }) => {
  const { platform } = await params;
  const def = getPlatform(platform);
  if (!def) return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  const body = (await req.json()) as Record<string, string>;
  await savePlatformApp(platform, body);
  await prisma.auditLog.create({ data: { action: "credential_changed", resource: "platform_app", resourceId: platform } });
  return NextResponse.json({ ok: true, app: await describePlatformApp(platform) });
});
