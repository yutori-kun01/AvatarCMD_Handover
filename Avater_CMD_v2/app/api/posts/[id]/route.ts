import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/posts/[id]
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        avatar: { select: { id: true, name: true, avatarImageUrl: true } },
      },
    })

    if (!post) {
      return NextResponse.json(
        { error: "投稿が見つかりません" },
        { status: 404 }
      )
    }

    return NextResponse.json(post)
  } catch (error) {
    console.error("Failed to fetch post:", error)
    return NextResponse.json(
      { error: "投稿の取得に失敗しました" },
      { status: 500 }
    )
  }
}

// PATCH /api/posts/[id] - Update post
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()

    // Handle scheduledAt conversion
    if (body.scheduledAt) {
      body.scheduledAt = new Date(body.scheduledAt)
    }

    const post = await prisma.post.update({
      where: { id },
      data: body,
      include: {
        avatar: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(post)
  } catch (error) {
    console.error("Failed to update post:", error)
    return NextResponse.json(
      { error: "投稿の更新に失敗しました" },
      { status: 500 }
    )
  }
}

// DELETE /api/posts/[id]
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { avatarId: true, platform: true, content: true },
    })
    await prisma.post.delete({ where: { id } })

    if (post) {
      await prisma.activity.create({
        data: {
          avatarId: post.avatarId,
          type: "post_deleted",
          title: `${post.platform} の投稿を削除`,
          description: post.content.substring(0, 80),
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete post:", error)
    return NextResponse.json(
      { error: "投稿の削除に失敗しました" },
      { status: 500 }
    )
  }
}
