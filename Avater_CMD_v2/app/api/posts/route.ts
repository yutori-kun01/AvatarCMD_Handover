import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/posts - List posts (filterable by avatar, platform, status)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const avatarId = searchParams.get("avatarId")
    const platform = searchParams.get("platform")
    const status = searchParams.get("status")

    const where: Record<string, unknown> = {}
    if (avatarId) where.avatarId = avatarId
    if (platform) where.platform = platform
    if (status) where.status = status

    const posts = await prisma.post.findMany({
      where,
      include: {
        avatar: {
          select: { id: true, name: true, avatarImageUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return NextResponse.json(posts)
  } catch (error) {
    console.error("Failed to fetch posts:", error)
    return NextResponse.json(
      { error: "投稿の取得に失敗しました" },
      { status: 500 }
    )
  }
}

// POST /api/posts - Create a new post
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { avatarId, platform, content, mediaUrls, status, scheduledAt } = body

    if (!avatarId || !platform || !content) {
      return NextResponse.json(
        { error: "avatarId, platform, content は必須です" },
        { status: 400 }
      )
    }

    const post = await prisma.post.create({
      data: {
        avatarId,
        platform,
        content,
        mediaUrls: mediaUrls || [],
        status: status || "DRAFT",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
      include: {
        avatar: {
          select: { id: true, name: true },
        },
      },
    })

    // Log activity
    await prisma.activity.create({
      data: {
        avatarId,
        type: "post_created",
        title: `${platform} 投稿を作成`,
        description: content.substring(0, 100),
      },
    })

    return NextResponse.json(post, { status: 201 })
  } catch (error) {
    console.error("Failed to create post:", error)
    return NextResponse.json(
      { error: "投稿の作成に失敗しました" },
      { status: 500 }
    )
  }
}
