import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma, type ContentStatus } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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

// GET /api/posts/[id]
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const post = await prisma.content.findFirst({
      where: { id, avatar: { userId: user.id } },
      include: { avatar: AVATAR_SUMMARY, scheduledPost: true },
    });

    if (!post) {
      return NextResponse.json({ error: "投稿が見つかりません" }, { status: 404 });
    }

    return NextResponse.json(post);
  } catch (error) {
    return handleApiError("投稿の取得", error);
  }
}

// PATCH /api/posts/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const owned = await prisma.content.findFirst({
      where: { id, avatar: { userId: user.id } },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "投稿が見つかりません" }, { status: 404 });
    }

    const body = await request.json();
    const data: Prisma.ContentUpdateInput = {};

    if (typeof body.content === "string") data.content = body.content;
    if (typeof body.platform === "string") data.platform = body.platform;
    if (typeof body.category === "string") data.category = body.category;
    if (typeof body.status === "string") {
      if (!CONTENT_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: `status は ${CONTENT_STATUSES.join(" / ")} のいずれかです` },
          { status: 400 }
        );
      }
      data.status = body.status;
    }

    // 予約日時は ScheduledPost 側で管理する
    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt === null) {
        data.scheduledPost = { delete: true };
        data.status = data.status ?? "DRAFT";
      } else {
        const scheduleDate = new Date(body.scheduledAt);
        if (Number.isNaN(scheduleDate.getTime())) {
          return NextResponse.json(
            { error: "scheduledAt の形式が不正です" },
            { status: 400 }
          );
        }
        data.scheduledPost = {
          upsert: {
            create: { scheduledAt: scheduleDate },
            update: { scheduledAt: scheduleDate },
          },
        };
        data.status = data.status ?? "SCHEDULED";
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "更新可能な項目がありません" }, { status: 400 });
    }

    const post = await prisma.content.update({
      where: { id },
      data,
      include: { avatar: AVATAR_SUMMARY, scheduledPost: true },
    });

    return NextResponse.json(post);
  } catch (error) {
    return handleApiError("投稿の更新", error);
  }
}

// DELETE /api/posts/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireWriteUser();
    const { id } = await context.params;

    const post = await prisma.content.findFirst({
      where: { id, avatar: { userId: user.id } },
      select: { id: true, avatarId: true, platform: true, content: true },
    });
    if (!post) {
      return NextResponse.json({ error: "投稿が見つかりません" }, { status: 404 });
    }

    await prisma.content.delete({ where: { id: post.id } });

    await prisma.activityLog.create({
      data: {
        avatarId: post.avatarId,
        action: "post_deleted",
        category: "content",
        description: `${post.platform} の投稿を削除: ${post.content.slice(0, 80)}`,
        level: "warning",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("投稿の削除", error);
  }
}
