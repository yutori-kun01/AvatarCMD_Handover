// 動画パイプラインの設定（上限値・合格ライン・工程ごとの画像生成・Fish Audio・計測サーバー・Kling の動画化）
import { NextResponse } from "next/server";
import { describeKling, describeVideoSettings, saveKlingSettings, saveVideoSettings, VIDEO_PROFILES, VIDEO_TARGETS, type KlingInput, type VideoSettingsInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const describe = async () => ({ ...(await describeVideoSettings()), kling: await describeKling() });

export const GET = route(async () => NextResponse.json({ settings: await describe(), profiles: VIDEO_PROFILES, targets: VIDEO_TARGETS }));

export const PUT = route(async (req: Request) => {
  const b = (await req.json()) as VideoSettingsInput & { kling?: KlingInput };
  // Kling（動画化）の設定は別に保存する
  if (b.kling) await saveKlingSettings(b.kling);
  await saveVideoSettings(b);
  return NextResponse.json({ settings: await describe() });
});
