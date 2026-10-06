// note 記事の本文を AI で書く（有料なら有料ラインの位置も提案）
import { NextResponse } from "next/server";
import { generateNoteArticle } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; topic: string; paid?: boolean; extraPrompt?: string };
  if (!b.topic?.trim()) return NextResponse.json({ error: "テーマを入力してください" }, { status: 400 });
  return NextResponse.json(await generateNoteArticle({ avatarId: b.avatarId, topic: b.topic.trim(), paid: !!b.paid, extraPrompt: b.extraPrompt }));
});
