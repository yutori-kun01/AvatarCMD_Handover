// 投稿画面の「AIで文字数調整」: 口調を保ったまま文字数制限内に書き直す
import { NextResponse } from "next/server";
import { rewriteToFit } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarId: string; text: string; maxLength: number; platform?: string };
  if (!b.text?.trim()) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  const maxLength = Number(b.maxLength);
  if (!Number.isInteger(maxLength) || maxLength < 10) return NextResponse.json({ error: "文字数の上限が不正です" }, { status: 400 });
  return NextResponse.json(await rewriteToFit({ avatarId: b.avatarId, text: b.text, maxLength, platform: b.platform }));
});
