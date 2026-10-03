import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { updateChannel, type ChannelInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await updateChannel(id, (await req.json()) as ChannelInput);
  return NextResponse.json({ ok: true });
});

// 登録の解除（作成済みのナレッジは残る）
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await prisma.youtubeChannel.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
