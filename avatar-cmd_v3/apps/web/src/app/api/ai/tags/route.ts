// 投稿画面の「AIでタグ提案」
import { NextResponse } from "next/server";
import { suggestTags } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { text: string; platform?: string; max?: number };
  if (!b.text?.trim()) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  return NextResponse.json(await suggestTags({ text: b.text, platform: b.platform, max: b.max }));
});
