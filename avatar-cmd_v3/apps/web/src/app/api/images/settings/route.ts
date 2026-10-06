// 画像生成の設定（プロバイダ・モデル・画質）。API キーは 設定 > システム > AI と共通
import { NextResponse } from "next/server";
import { getImageSettings, IMAGE_PROVIDERS, saveImageSettings } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ settings: await getImageSettings(), providers: IMAGE_PROVIDERS }));

export const PUT = route(async (req: Request) => {
  await saveImageSettings(await req.json());
  return NextResponse.json({ settings: await getImageSettings() });
});
