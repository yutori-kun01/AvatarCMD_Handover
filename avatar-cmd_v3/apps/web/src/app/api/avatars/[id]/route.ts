import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";
import { applyGenre, avatarData } from "@/lib/avatar-input";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  await prisma.avatar.update({ where: { id }, data: avatarData(body, false) as any });
  // ステータスだけの変更（一時停止・再開）ではジャンルを見直さない
  if (body.genre !== undefined || Object.keys(body).some((k) => k !== "status")) await applyGenre(id, body.genre);
  return NextResponse.json({ ok: true });
});

// 削除すると接続アカウント・投稿・自動化ルールも削除される（コラボは先に外す）
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if ((await prisma.avatar.count()) <= 1) return NextResponse.json({ error: "最後のアバターは削除できません" }, { status: 400 });
  await prisma.collaboration.deleteMany({ where: { OR: [{ initiatorId: id }, { partnerId: id }] } });
  await prisma.avatar.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
