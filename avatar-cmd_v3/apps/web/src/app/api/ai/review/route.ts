// 投稿画面の「AIでチェック」: 事実誤り・炎上リスク・ルール違反などを公開前に確認する
import { NextResponse } from "next/server";
import { reviewPost } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { text: string; avatarId?: string; platform?: string };
  if (!b.text?.trim()) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  return NextResponse.json(await reviewPost({ text: b.text, avatarId: b.avatarId, platform: b.platform }));
});
