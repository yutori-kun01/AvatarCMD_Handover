// 投稿画面の「AIで下書き」
import { NextResponse } from "next/server";
import { generatePostText } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; topic: string; platform?: string; extraPrompt?: string };
  if (!b.topic?.trim()) return NextResponse.json({ error: "トピックを入力してください" }, { status: 400 });
  return NextResponse.json(await generatePostText({ avatarId: b.avatarId, topic: b.topic.trim(), platform: b.platform, extraPrompt: b.extraPrompt }));
});
