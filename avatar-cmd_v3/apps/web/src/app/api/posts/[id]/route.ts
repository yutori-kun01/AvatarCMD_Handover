import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@avatar-cmd/db";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";
import { platformOf } from "@/lib/post-input";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, ctx: Context) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const post = await prisma.content.findFirst({
      where: { id, avatar: { userId: user.id } },
      include: { scheduledPost: true },
    });
    return post
      ? NextResponse.json(post)
      : NextResponse.json({ error: "投稿が見つかりません" }, { status: 404 });
  } catch (e) {
    return handleApiError("投稿の取得", e);
  }
}
export async function PATCH(request: NextRequest, ctx: Context) {
  try {
    const user = await requireWriteUser();
    const { id } = await ctx.params;
    const body = await request.json();
    const post = await prisma.content.findFirst({
      where: { id, avatar: { userId: user.id } },
    });
    if (!post)
      return NextResponse.json(
        { error: "投稿が見つかりません" },
        { status: 404 },
      );
    if (["PUBLISHING", "PUBLISHED"].includes(post.status))
      return NextResponse.json(
        { error: "送信中・公開済みの投稿は変更できません" },
        { status: 409 },
      );
    const data: Prisma.ContentUpdateManyMutationInput = {};
    if (body.content !== undefined) {
      if (
        typeof body.content !== "string" ||
        !body.content.trim() ||
        body.content.length > 140000
      )
        return NextResponse.json(
          { error: "本文を確認してください" },
          { status: 400 },
        );
      data.content = body.content;
      data.status = "DRAFT";
    }
    if (body.platform !== undefined) {
      try {
        data.platform = platformOf(body.platform);
      } catch {
        return NextResponse.json({ error: "SNSが不正です" }, { status: 400 });
      }
      data.status = "DRAFT";
    }
    if (body.status !== undefined) {
      if (!["DRAFT", "APPROVED", "ARCHIVED"].includes(body.status))
        return NextResponse.json({ error: "状態が不正です" }, { status: 400 });
      data.status = body.status;
    }
    let scheduledAt: Date | null = null;
    if (body.scheduledAt !== undefined) {
      scheduledAt =
        body.scheduledAt === null ? null : new Date(body.scheduledAt);
      if (
        scheduledAt &&
        (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date())
      )
        return NextResponse.json(
          { error: "予約は未来の日時を指定してください" },
          { status: 400 },
        );
      data.status = scheduledAt ? "SCHEDULED" : "DRAFT";
    }
    if (!Object.keys(data).length)
      return NextResponse.json(
        { error: "変更内容がありません" },
        { status: 400 },
      );
    const changed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.content.updateMany({
        where: {
          id,
          updatedAt: post.updatedAt,
          status: { notIn: ["PUBLISHING", "PUBLISHED"] },
          avatar: { userId: user.id },
        },
        data,
      });
      if (!claimed.count) return false;
      if (scheduledAt)
        await tx.scheduledPost.upsert({
          where: { contentId: id },
          create: { contentId: id, scheduledAt },
          update: {
            scheduledAt,
            status: "pending",
            attempts: 0,
            lastError: null,
          },
        });
      else if (data.status)
        await tx.scheduledPost.deleteMany({ where: { contentId: id } });
      await tx.activityLog.create({
        data: {
          avatarId: post.avatarId,
          action: "post_updated",
          category: "content",
          description:
            data.status === "APPROVED" || data.status === "SCHEDULED"
              ? "投稿内容を承認しました"
              : "投稿を更新しました",
          metadata: { contentId: id },
        },
      });
      return true;
    });
    return changed
      ? NextResponse.json({ success: true })
      : NextResponse.json(
          { error: "投稿の状態が変わりました。再読み込みしてください" },
          { status: 409 },
        );
  } catch (e) {
    return handleApiError("投稿の更新", e);
  }
}
export async function DELETE(_request: NextRequest, ctx: Context) {
  try {
    const user = await requireWriteUser();
    const { id } = await ctx.params;
    const removed = await prisma.content.deleteMany({
      where: {
        id,
        avatar: { userId: user.id },
        status: { notIn: ["PUBLISHING", "PUBLISHED"] },
      },
    });
    return removed.count
      ? NextResponse.json({ success: true })
      : NextResponse.json(
          { error: "送信中・公開済み、または削除できない投稿です" },
          { status: 409 },
        );
  } catch (e) {
    return handleApiError("投稿の削除", e);
  }
}
