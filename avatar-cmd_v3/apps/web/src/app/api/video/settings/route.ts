// 動画パイプラインの設定（上限値・合格ライン・工程ごとの画像生成・Fish Audio・計測サーバー）
import { NextResponse } from "next/server";
import { describeVideoSettings, saveVideoSettings, VIDEO_PROFILES, VIDEO_TARGETS } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ settings: await describeVideoSettings(), profiles: VIDEO_PROFILES, targets: VIDEO_TARGETS }));

export const PUT = route(async (req: Request) => {
  await saveVideoSettings(await req.json());
  return NextResponse.json({ settings: await describeVideoSettings() });
});
