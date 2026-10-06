// 見出し画像（アイキャッチ）を生成する
import { NextResponse } from "next/server";
import { generateEyecatch } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 180;

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; title: string; summary?: string };
  if (!b.title?.trim()) return NextResponse.json({ error: "タイトルを入力してください" }, { status: 400 });
  return NextResponse.json({ media: await generateEyecatch({ avatarId: b.avatarId, title: b.title.trim(), summary: b.summary }) });
});
