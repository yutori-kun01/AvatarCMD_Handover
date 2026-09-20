// ================================================
// /api/posts — 投稿 (v3 では Content モデル)
// ================================================
// v2 の Post モデルに相当。v3 では Content が本体で、
// 予約投稿は ScheduledPost に分離されている。

import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma, type ContentStatus } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

import { platformOf } from "@/lib/post-input";

export const dynamic = "force-dynamic";

const CONTENT_STATUSES: ContentStatus[] = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "ARCHIVED",
];

const AVATAR_SUMMARY = {
  select: { id: true, name: true, avatarImageUrl: true },
} as const;

// GET /api/posts — avatarId / platform / status で絞り込み
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);

    const where: Prisma.ContentWhereInput = { avatar: { userId: user.id } };
    const avatarId = searchParams.get("avatarId");
    const platform = searchParams.get("platform");
    const status = searchParams.get("status");
    if (avatarId) where.avatarId = avatarId;
    if (platform) where.platform = platform;
    if (status) {
      if (!CONTENT_STATUSES.includes(status as ContentStatus)) {
        return NextResponse.json(
          { error: `status は ${CONTENT_STATUSES.join(" / ")} のいずれかです` },
          { status: 400 },
        );
      }
      where.status = status as ContentStatus;
    }

    const posts = await prisma.content.findMany({
      where,
      include: { avatar: AVATAR_SUMMARY, scheduledPost: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(posts);
  } catch (error) {
    return handleApiError("投稿の取得", error);
  }
}

// POST /api/posts
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    const {
      avatarId,
      platform,
      content,
      mediaUrls,
      status,
      scheduledAt,
      category,
    } = body;

    if (!avatarId || !platform || !content) {
      return NextResponse.json(
        { error: "avatarId, platform, content は必須です" },
        { status: 400 },
      );
    }
    if (status && !["DRAFT", "APPROVED"].includes(status)) {
      return NextResponse.json(
        { error: `status は ${CONTENT_STATUSES.join(" / ")} のいずれかです` },
        { status: 400 },
      );
    }

    let normalizedPlatform;
    try {
      normalizedPlatform = platformOf(platform);
    } catch {
      return NextResponse.json({ error: "SNSが不正です" }, { status: 400 });
    }
    if (
      typeof content !== "string" ||
      !content.trim() ||
      content.length > 140000
    )
      return NextResponse.json(
        { error: "本文は1〜140000文字で入力してください" },
        { status: 400 },
      );
    const owned = await prisma.avatar.findFirst({
      where: { id: String(avatarId), userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "アバターが見つかりません" },
        { status: 404 },
      );
    }

    const scheduleDate = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduleDate && Number.isNaN(scheduleDate.getTime())) {
      return NextResponse.json(
        { error: "scheduledAt の形式が不正です" },
        { status: 400 },
      );
    }

    const post = await prisma.content.create({
      data: {
        avatarId: owned.id,
        platform: normalizedPlatform,
        content: String(content),
        category: category ? String(category) : "viral",
        // v3 の Content に mediaUrls 列はないため metadata に収める
        metadata: (Array.isArray(mediaUrls)
          ? { mediaUrls: mediaUrls.filter((u) => typeof u === "string") }
          : {}) as Prisma.InputJsonValue,
        status: scheduleDate
          ? "SCHEDULED"
          : ((status as ContentStatus) ?? "DRAFT"),
        ...(scheduleDate
          ? { scheduledPost: { create: { scheduledAt: scheduleDate } } }
          : {}),
      },
      include: { avatar: AVATAR_SUMMARY, scheduledPost: true },
    });

    await prisma.activityLog.create({
      data: {
        avatarId: owned.id,
        action: "post_created",
        category: "content",
        description: `${post.platform} 投稿を作成: ${post.content.slice(0, 80)}`,
        level: "info",
      },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    return handleApiError("投稿の作成", error);
  }
}
