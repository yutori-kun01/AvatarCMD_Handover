import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 未送信（予約中・失敗）の投稿のみ削除できる
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await prisma.content.findUniqueOrThrow({ where: { id } });
  if (c.status === "PUBLISHED" || c.status === "PUBLISHING") {
    return NextResponse.json({ error: "送信済み・送信中の投稿は削除できません（各SNS側で削除してください）" }, { status: 400 });
  }
  await prisma.content.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
