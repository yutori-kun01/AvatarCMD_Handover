import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { discardContent } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 下書きの本文修正
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { text } = (await req.json()) as { text?: string };
  const c = await prisma.content.findUniqueOrThrow({ where: { id } });
  if (c.status !== "DRAFT") return NextResponse.json({ error: "下書きのみ編集できます" }, { status: 400 });
  if (!text?.trim()) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  await prisma.content.update({ where: { id }, data: { content: text } });
  return NextResponse.json({ ok: true });
});

// 未送信（下書き・予約中・失敗）の投稿のみ削除できる。下書きの削除は判定ログに「却下」として残す
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await discardContent(id);
  return NextResponse.json({ ok: true });
});
