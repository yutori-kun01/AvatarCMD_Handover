// アバター専用の開発者アプリ（Client ID / Secret 等）。共通の「SNS連携アプリ」設定をこのアバターだけ上書きする
import { NextResponse } from "next/server";
import { getPlatform } from "@avatar-cmd/integrations";
import { deleteAvatarPlatformApp, describeAvatarPlatformApp, saveAvatarPlatformApp } from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; platform: string }> };

async function check(id: string, platform: string) {
  if (!getPlatform(platform)?.appFields.length) return NextResponse.json({ error: "このプラットフォームはアプリ登録が不要です" }, { status: 404 });
  if (!(await prisma.avatar.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "アバターが見つかりません" }, { status: 404 });
  return null;
}

export const PUT = route(async (req: Request, { params }: Ctx) => {
  const { id, platform } = await params;
  const bad = await check(id, platform);
  if (bad) return bad;
  await saveAvatarPlatformApp(id, platform, (await req.json()) as Record<string, string>);
  await prisma.auditLog.create({ data: { action: "credential_changed", resource: "avatar_platform_app", resourceId: `${id}:${platform}` } });
  return NextResponse.json({ ok: true, app: await describeAvatarPlatformApp(id, platform) });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id, platform } = await params;
  const bad = await check(id, platform);
  if (bad) return bad;
  await deleteAvatarPlatformApp(id, platform);
  await prisma.auditLog.create({ data: { action: "credential_deleted", resource: "avatar_platform_app", resourceId: `${id}:${platform}` } });
  // 専用アプリで接続済みのアカウントはトークン更新できなくなるので件数を返す（画面で再接続を促す）
  const affected = await prisma.snsAccount.count({ where: { avatarId: id, platform, appScope: "avatar" } });
  return NextResponse.json({ ok: true, affected });
});
