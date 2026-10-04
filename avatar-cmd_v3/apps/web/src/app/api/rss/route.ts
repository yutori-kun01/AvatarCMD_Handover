// RSS フィードからの学習: フィードの一覧・登録
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { ARTICLE_STATUS_LABEL, createFeed, type FeedInput } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [feeds, avatars] = await Promise.all([
    prisma.rssFeed.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        articles: {
          orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          take: 30,
          select: { id: true, url: true, title: true, publishedAt: true, excerpt: true, status: true, contentMethod: true, contentAt: true, summary: true, summaryEvidence: true, knowledgeIds: true, attempts: true, error: true },
        },
      },
    }),
    prisma.avatar.findMany({ select: { id: true, name: true } }),
  ]);
  return NextResponse.json({ feeds, avatars, statusLabels: ARTICLE_STATUS_LABEL });
});

export const POST = route(async (req: Request) => {
  const f = await createFeed((await req.json()) as FeedInput);
  return NextResponse.json({ ok: true, id: f.id });
});
