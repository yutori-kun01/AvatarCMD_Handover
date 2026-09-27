// 設定画面用: プラットフォーム定義・開発者アプリの登録状況・接続済みアカウント・システム設定
import { NextResponse } from "next/server";
import { PLATFORM_LIST } from "@avatar-cmd/integrations";
import {
  describePlatformApp, ensureDefaultAvatar, getSetting, getSystemConfig, listAccounts, mask, redirectUriFor, SETTING_KEYS,
} from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await ensureDefaultAvatar();
  const system = await getSystemConfig();
  const gemini = await getSetting(SETTING_KEYS.geminiApiKey);
  const platforms = await Promise.all(
    PLATFORM_LIST.map(async (p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      support: p.support,
      connection: p.connection,
      maxLength: p.maxLength,
      appFields: p.appFields,
      accountFields: p.accountFields,
      settingFields: p.settingFields,
      postFields: p.postFields,
      media: p.media,
      docs: p.docs,
      notes: p.notes,
      redirectUri: p.connection === "oauth" ? redirectUriFor(system.appUrl, p.id) : null,
      app: p.appFields.length ? await describePlatformApp(p.id) : null,
    }))
  );
  const avatars = await prisma.avatar.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    system: { ...system, geminiApiKey: gemini ? mask(gemini) : "", appUrlFromEnv: process.env.APP_URL ?? null },
    platforms,
    avatars,
    accounts: await listAccounts(),
    encryptionReady: !!process.env.ENCRYPTION_KEY,
  });
});
