import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/avatars/[id] - Get avatar with full details
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const avatar = await prisma.avatar.findUnique({
      where: { id },
      include: {
        platforms: true,
        posts: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        revenue: {
          orderBy: { earnedAt: "desc" },
          take: 20,
        },
        knowledge: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        automations: true,
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    })

    if (!avatar) {
      return NextResponse.json(
        { error: "アバターが見つかりません" },
        { status: 404 }
      )
    }

    return NextResponse.json(avatar)
  } catch (error) {
    console.error("Failed to fetch avatar:", error)
    return NextResponse.json(
      { error: "アバターの取得に失敗しました" },
      { status: 500 }
    )
  }
}

// PATCH /api/avatars/[id] - Update avatar
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    const avatar = await prisma.avatar.update({
      where: { id },
      data: body,
    })
    return NextResponse.json(avatar)
  } catch (error) {
    console.error("Failed to update avatar:", error)
    return NextResponse.json(
      { error: "アバターの更新に失敗しました" },
      { status: 500 }
    )
  }
}

// DELETE /api/avatars/[id] - Delete avatar
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  try {
    await prisma.avatar.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete avatar:", error)
    return NextResponse.json(
      { error: "アバターの削除に失敗しました" },
      { status: 500 }
    )
  }
}
