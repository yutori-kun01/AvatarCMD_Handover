// 投稿の一覧と作成（作成した投稿は予約キューに入り、worker が送信する）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { getPlatform } from "@avatar-cmd/integrations";
import { createPosts, type MediaRef } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const rows = await prisma.content.findMany({
    where: { snsAccountId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { scheduledPost: true, snsAccount: { select: { accountName: true } } },
  });
  return NextResponse.json({
    posts: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      platformName: getPlatform(r.platform)?.name ?? r.platform,
      accountName: r.snsAccount?.accountName ?? "(削除済み)",
      text: r.content,
      status: r.status,
      postUrl: r.postUrl,
      note: ((r.metadata as any)?.result?.note as string) ?? (r.status === "DRAFT" ? reviewNote((r.metadata as any)?.review) : undefined) ?? null,
      scheduledAt: r.scheduledPost?.scheduledAt ?? null,
      publishedAt: r.publishedAt,
      attempts: r.scheduledPost?.attempts ?? 0,
      lastError: r.scheduledPost?.lastError ?? null,
      createdAt: r.createdAt,
    })),
  });
});

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as {
    accountIds: string[];
    text: string;
    title?: string;
    link?: string;
    tags?: string[];
    media?: MediaRef[];
    options?: Record<string, Record<string, string>>;
    scheduledAt?: string;
  };
  if (!b.text?.trim()) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : undefined;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "予約日時が不正です" }, { status: 400 });
  const created = await createPosts({
    accountIds: b.accountIds ?? [],
    text: b.text,
    title: b.title?.trim() || undefined,
    link: b.link?.trim() || undefined,
    tags: b.tags?.filter(Boolean),
    media: b.media ?? [],
    options: b.options ?? {},
    scheduledAt,
  });
  return NextResponse.json({ ok: true, count: created.length });
});

/** 自動化の投稿前チェックで下書きに回された理由 */
function reviewNote(review: { verdict?: string; summary?: string; error?: string } | undefined): string | undefined {
  if (!review || review.verdict === "ok") return undefined;
  if (review.error) return `投稿前チェックに失敗したため保留: ${review.error.slice(0, 120)}`;
  return `投稿前チェックで保留（${review.verdict === "ng" ? "公開不可" : "要確認"}）: ${review.summary ?? ""}`;
}
