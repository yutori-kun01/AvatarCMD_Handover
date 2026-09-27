// システム設定（公開URL・APIバージョン・AIキー）
import { NextResponse } from "next/server";
import { setSetting, SETTING_KEYS } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PUT = route(async (req: Request) => {
  const b = (await req.json()) as Record<string, string | undefined>;
  if (b.appUrl !== undefined) {
    const v = b.appUrl.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\/[^/]+/.test(v)) return NextResponse.json({ error: "公開URLは http(s):// から始めてください" }, { status: 400 });
    await setSetting(SETTING_KEYS.appUrl, v || null);
  }
  if (b.metaGraphVersion !== undefined) {
    const v = b.metaGraphVersion.trim();
    if (v && !/^v\d+\.\d+$/.test(v)) return NextResponse.json({ error: "Graph API バージョンは v26.0 の形式で入力してください" }, { status: 400 });
    await setSetting(SETTING_KEYS.metaGraphVersion, v || null);
  }
  if (b.linkedinVersion !== undefined) {
    const v = b.linkedinVersion.trim();
    if (v && !/^\d{6}$/.test(v)) return NextResponse.json({ error: "LinkedIn-Version は YYYYMM の形式で入力してください" }, { status: 400 });
    await setSetting(SETTING_KEYS.linkedinVersion, v || null);
  }
  if (b.geminiModel !== undefined) {
    const v = b.geminiModel.trim();
    if (v && !/^[a-z0-9.\-]+$/i.test(v)) return NextResponse.json({ error: "モデル名が不正です" }, { status: 400 });
    await setSetting(SETTING_KEYS.geminiModel, v || null);
  }
  if (b.geminiApiKey !== undefined && b.geminiApiKey.trim() !== "") {
    await setSetting(SETTING_KEYS.geminiApiKey, b.geminiApiKey.trim() === "-" ? null : b.geminiApiKey.trim());
  }
  return NextResponse.json({ ok: true });
});
