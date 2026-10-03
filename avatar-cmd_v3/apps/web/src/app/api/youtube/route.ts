// YouTube チャンネルからの学習: チャンネルの一覧・登録
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { createChannel, TRANSCRIPT_STATUS_LABEL, type ChannelInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [channels, avatars, youtubeAccounts] = await Promise.all([
    prisma.youtubeChannel.findMany({
      orderBy: { createdAt: "asc" },
      include: { videos: { orderBy: { publishedAt: "desc" }, take: 30, select: { id: true, videoId: true, url: true, title: true, publishedAt: true, transcriptStatus: true, transcriptMethod: true, transcriptAt: true, summary: true, summaryEvidence: true, knowledgeIds: true, error: true } } },
    }),
    prisma.avatar.findMany({ select: { id: true, name: true } }),
    prisma.snsAccount.findMany({ where: { platform: "youtube" }, select: { id: true, accountName: true, avatarId: true } }),
  ]);
  return NextResponse.json({ channels, avatars, youtubeAccounts, statusLabels: TRANSCRIPT_STATUS_LABEL });
});

export const POST = route(async (req: Request) => {
  const ch = await createChannel((await req.json()) as ChannelInput);
  return NextResponse.json({ ok: true, id: ch.id });
});
