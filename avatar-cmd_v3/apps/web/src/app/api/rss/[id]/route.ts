import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { updateFeed, type FeedInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await updateFeed(id, (await req.json()) as FeedInput);
  return NextResponse.json({ ok: true });
});

// 登録の解除（作成済みのナレッジは残る）
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.rssFeed.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
